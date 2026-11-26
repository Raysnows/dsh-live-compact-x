> 这份文档把插件的几个「手感旋钮」写成公式，并给出本机实测的数值。
> 目的不是炫技，是让每次调参都有依据：切不切、切多长、留哪几行、大刀还是脚本。

# 一、这一刀该不该切

设当前会话 token 数 $C$，一刀切掉 $s$ token，留下的卡片占 $c$ token（$c \ll s$）。

**每轮省下的 token**：$\Delta = s - c$

**一次性成本**：这一刀会让前缀缓存失效，下一次请求要把新的前缀重写一遍，
重写面约等于 $m$（实测 missTokens，通常远小于 $C$）。按缓存计费模型
（命中 $0.1\times$、未命中 $1.0\times$、写入 $1.25\times$ 基价 [[1]](https://research.gaiaskilltree.com/blog/context-compaction-curve)）：

$$ \text{cost} = 1.25 \cdot m \cdot p_{in} + c \cdot p_{out} $$

**回本轮数**（多久赚回来）：

$$ T = \frac{1.25 \, m}{\Delta} $$

代码里的 `paybackTurns` 就是 $T$ 的上限：$T > \text{paybackTurns}$ 就不切。
实测这条门槛最常拦人（本机 39 刀里被拦 15 次），因为大刀一刀的 $m$ 常到 18–39 万。

**净收益门槛** `minNetGain` 是另一条独立约束：$\Delta \ge \text{minNetGain}$，防止「切了个寂寞」。

# 二、一刀切多长

一刀的上限 $\text{chunkMax}$（默认 32k）不能随便放大：卡片要能装下这一段的硬事实，
否则覆盖率检查直接把这一刀判死。而一刀太小又会把同一段拆成好几刀、每刀都要重算一次缓存。

从实测分布定：本机 39 刀的段长 p50 = 12.0k、p90 = 20.3k，卡片 p50 = 1.1k（原文的 11%）。
所以 `chunkMax = 32000` 落在 p90 之上一点：绝大多数刀能一次装下，又不会让一刀的重算面太大。

动态刀长 $\text{band} = C \cdot \text{spanBandRatio}$，夹在 $[\text{chunkMin}, \text{chunkMax}]$ 之间。
它让「上下文越大、一刀越大」，代价是单刀重算面跟着涨——这就是为什么默认只给 0.06。

# 三、卡片里留哪几行：带预算的最大覆盖

脚本卡（大刀本地归纳）一次吃掉几十 k 到几 M 字符，Kept 预算只有 8k–40k 字符。
这是一个**带预算的最大覆盖**问题：

$$ \max_{x \in \{0,1\}^n} \sum_i v_i x_i \quad \text{s.t.} \quad \sum_i w_i x_i \le B $$

- $v_i$：这一行的价值（见下）
- $w_i$：字符数
- $B$：Kept 预算

它是 NP-hard，但价值函数满足边际收益递减（submodular），所以**按密度贪心**
$v_i / w_i^{\alpha}$ 有 $(1 - 1/e)$ 的近似保证 [[2]](https://www.formalrag.com/topics/context-selection-submodular-dpp/)。

再加一层 MMR 去重 [[3]]：同一段报错被抄三遍，等于把预算花在同一件事上。

$$ \text{score}_i = \frac{v_i}{w_i^{\alpha}} \cdot \bigl(1 - \lambda \max_{j \in S} \text{sim}(i, j)\bigr) $$

- $\text{sim}$ 用词的 Jaccard（英文词 + 中文二元组），相似度 $\ge 0.6$ 直接丢弃
- $\alpha = 0.6$：偏向信息密度高的短行（把整段 JSON 糊进来的行会吃亏）
- $\lambda = 0.5$：去重强度

**价值 $v_i$ 的先验**（写在 `src/engine/select.js` 里）：用户约束 +4、报错/失败 +3、
带路径 +2.5、命令 +2、带数字事实 +1.5、截止/待办 +1.5；超长行按长度打折。

**实测**（本机会话 231,611 字符、3,415 行的一段，预算 4,000 字符）：

| 选行方式 | 预算用掉 | 保住的行 | 缺的硬事实 | 高价值行保留 |
|---|---|---|---|---|
| 先到先得（旧） | 3,978 | 55 | 7 | 47 |
| 密度 + 去重（新） | 3,906 | 59 | **3** | **52** |

同样预算：缺的事实少一半、多留 4 行、还少占 72 字符。

# 四、大刀：花模型钱还是花脚本时间

大刀整段归纳有两条路（`officialScript`）：

- **当前模型**：一次请求，输入约 $C$（实测 p50 = 33.4 万 token），输出约 4–6k token。
- **本地脚本**：零模型调用，但卡片会长期占住 prompt（$c$ token），每轮都要付 $c$ 的缓存价。

模型路的一次性成本 ≈ $C \cdot p_{in}$；脚本路的成本 ≈ $c \cdot p_{in}$ 摊在之后每一轮。
两者相等时：

$$ T^{*} = \frac{C}{c} $$

本机 $C/c \approx 300$：也就是说，脚本卡只有在「这一版要再用 300 轮以上」时才比模型便宜。
所以默认仍是模型，脚本留给「不想为归纳额外付一次请求」的场景。

# 五、实测数据（决定上面这些默认值的那组数）

| 指标 | 实测值 |
|---|---|
| 前缀缓存加权命中率 | 97.1% |
| 单轮 prompt 中位数 | 215–225k token |
| 小刀段长 p50 / p90 | 12.0k / 20.3k |
| 卡片长度 p50 / p90 | 1.1k / 2.0k（原文 11%） |
| 被拒样本的重算面 p50 | 18.9 万 token |
| 大刀输入 p50 | 33.4 万 token |
| 缓存在 >15–30 分钟空闲后冷启动 | 唯一真实的成本尖峰 |

> 结论：**「缓存已经冷了」才是切的最佳时机**——那时重算的钱无论如何都要花，
> 切一刀等于顺手把后面的预算也省了。

# 六、两个脚本版本（可切换）

`scriptEngine` 只决定「预算里先留哪几行」，不改刀法：

| 版本 | 选行规则 | 默认 |
|---|---|---|
| **新版**（`1`） | 价值密度 $v_i/w_i^{\alpha}$ + MMR 去重，硬事实先占预算 | ✅ 新装默认 |
| **稳定版**（`0`） | 按原文顺序先到先得 | 想可预期时切回 |

实测同一段 23 万字符、预算 4,000：缺的硬事实 7 → 3，高价值行 47 → 52。
小刀、中刀、大刀的本地卡片都读同一个开关，环境变量 `SPINE_SCRIPT_ENGINE` 可覆盖。

> 发版纪律（用户要求）：**每个版本的更新日志必须标参考文献**——
> 公式从哪来、数据在哪测的，都写成可点的链接，不写「业界实践」这种没出处的说法。

# 七、引用

1. Gaia Research, *The Context Compaction Curve* — 命中/未命中的价格倍数与冷启动成本
   https://research.gaiaskilltree.com/blog/context-compaction-curve
2. formalRAG, *Context Selection: Submodular Coverage, MMR, and DPP* — 次模覆盖与 $(1-1/e)$ 贪心
   https://www.formalrag.com/topics/context-selection-submodular-dpp/
3. Carbonell & Goldstein (1998), *The Use of MMR, Diversity-Based Reranking* — 去重公式
4. Nemhauser, Wolsey & Fisher (1978) — 贪心对单调次模函数的近似保证
5. Synthorai, *Context Compaction Cost: Measuring the Turns to Payback* — 回本轮的实测
   https://synthorai.io/blog/context-compaction-cost/
6. LLMLingua (arXiv:2310.05736) — 预算内的 prompt 压缩，同样的「价值密度」思路
   https://arxiv.org/abs/2310.05736
