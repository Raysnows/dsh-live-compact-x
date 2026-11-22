# dsh-live-compact-x

> **来源与致谢**
> 本仓库是 [dsh-live-compact](https://github.com/Tranquillitatis-Lab/dsh-live-compact) 的 fork，原作者 **MerkyorLynn**（MIT License）。
> 上游的核心设计——就地小切、每刀一张卡片、只动尾巴保住前缀缓存——都保留着，本 fork 只改压缩策略与存储层。
> 本 fork 由 **Raysnows**（<https://github.com/Raysnows>）维护。
> 如果只想用原版，请装上游包：`dsh-live-compact`。

## 它解决什么

对话做久了，工具输出越积越多。第一次压缩很好用，越往后越难：卡片越切越多，每张卡都是一堵墙，
后面只能一刀几 k 地削；上下文贴着上限走，缓存被反复重算。

本 fork 在保留上游机制的前提下加了三件事：

1. **净收益门槛**——切掉的 token 必须明显大于这张卡的成本，不再“切了个寂寞”；
2. **零副本存储**——被切掉的原文不另存一份，卡片只记事件号，回读时从会话日志取（实测省 10 倍空间）；
3. **大刀 + 小刀**——小刀照旧切尾巴；追不上时请官方大压缩出手，压完继续小刀。

> 还有一个**中刀**（卡片合并：从某张旧卡一路切到尾巴，整段重压成一张卡），默认**关闭**——它一次会吃掉很大一段原文，属于“顶不住时才开”的档位。
> 它还没验收：本机真实会话里 16 次尝试全被回本门槛拦下，一次都没真正落地。所以面板把它排在最后，打开要先看风险说明、勾「我明白风险」、再点确认——**二次确认**，关掉永远是一键。
> 账是这样算的：切完之后请求里只剩“新卡片 + 尾巴那几轮”，被吃掉的那一段不再进请求，前缀缓存照旧命中，
> 所以一次中刀的重算面通常只有几 k，而省下的往往是几十 k（实测 253k 的会话：切 118k、重算 16k、净赚 108k）。

## 安装

```
plugin_manager: install_bundle(target: "dsh-live-compact-x@1.3.17")
```

也可以直接用 npm 装：`npm i dsh-live-compact-x@1.3.17`（想跟 beta 通道就写 `@beta`）。装完重启宿主。它的 `cordis.patch.yml` 会先禁用官方 `compaction-basic` 的**插件安装位**，再插入自己。

### 推荐配合 `dsh-context` 一起用

[**`dsh-context`**](https://github.com/bowenliang123/dsh-context)（作者 **bowenliang123**）是上下文洞察插件：把「这段上下文由什么组成、是怎么长出来的」摊成一张仪表盘，另带 `context` 命令随手查。

两个插件回答的是不同问题，不重叠：

- `dsh-context`：**里面有什么**——系统提示、卡片、工具结果、尾巴各占多少，什么时候涨起来的；
- 本插件：**该不该切、切了多少、省了多少**——净收益、回本轮数、这一刀之后缓存重算了多少。

先看清构成，再来这里调刀法与阈值，判断才有依据。所以：**配合 `dsh-context` 使用观感更佳**。

```
plugin_manager: install_bundle(target: "dsh-context")
```

## 和官方 compaction-basic 是什么关系

**不是取代。** 位置确实顶掉了——同一个 context 只能有一个 `ctx.compaction`，所以补丁把官方的插件关掉、换成这个。
但**压缩逻辑没有换**：

- 本引擎继承官方的 `BasicCompactionEngine`，凡是官方摘要都直接走 `super.compactIfNeeded`；
  官方那套"整段摘要 + 保留最近若干轮"的行为一行没改。
- 差别只在**调度**：官方是"到阈值就整段摘"，这个插件先在旁边切几刀，把那条阈值尽量往后推。
  推不动了才把官方大压缩请出来，压完继续小刀。

所以它买到的是**更晚、更少的大压缩**（少一次整段重算 ≈ 少一次全量缓存未命中），
不是一套新的摘要算法。想退回官方行为，卸载插件即可。

## 面板：这个会话切了多少

装好后会话页签会多一个**压缩**（在「上下文」和「编队」之间）。切过去是**整页**：视图根上声明宿主的 composer overlay（外加我们自己的 `data-spine-cover`），宿主据此把视图撑满、收掉正文两侧的宽度拖拽条，输入条只在这个页签隐藏——切回「对话」立刻回来，不用刷新；面板内部滚动，最后一排不会再被输入条压住。

顶栏还有一个**总开关**：范围是「本会话」时管这一条会话，切到「全部会话」时管全部会话。关掉后不再用小刀 / 中刀 / 大刀，也不主动请官方压缩；宿主真的到了极限时仍由官方摘要兜底（`super.summarize`）。下一回合生效，重启也记得——状态写在 `~/.dsh/spine-switch.json`（全局 `enabled` + 每条会话的 `disabled` 名单），和旋钮那份设置文件分开。

顶部一层是**范围切换**：

- **本会话**：这条会话切过什么；
- **全部会话**：读 shadow 根目录那份决策日志（`spine-decisions.jsonl`），汇总所有会话的刀数与刀数占比。

内容从上到下：

1. **指标**：累计切掉、切刀数、我方卡片（小刀+中刀+旧卡）、官方卡片、最大一刀（本会话）/ 最多刀法（全部会话）、最近一刀；
2. **压缩构成条**：按刀法着色（小刀蓝 / 中刀紫 / 大刀橙 / 官方灰 / 旧卡青），悬停看范围与切掉量，图例带占比；
3. **刀法统计**：每种刀各切了几刀、切掉多少、占多少、平均一刀多大；
4. **时间线**：刀法徽标、切掉量、事件号范围、模型、时间、备份文件数；展开看卡片预览和备份文件名，路径一键复制。**默认只列最近 10 刀**，行距压紧，再往下是「展开其余 N 刀」——展开后限高滚动，几十刀也不会把面板撑成一条长龙；
5. **切点**（默认折叠，点一下展开）：小刀 / 大刀 / 中刀三组 15 个旋钮，和设置页同一份配置。展开后第一行是四个内置按钮：**推荐档**（日常能跑的一套：小刀常开、回本 8 轮、刀长 6%、45 万请官方收；中刀仍不碰）、**小刀优先**（多切小刀、大刀推迟到 60 万）、**大刀优先**（20 万就让官方收）、**自定义档**（清掉草稿），最右边一个 **＋**：把当前这套值存成自定义档，存的时候选范围——**本会话 / 本工作区 / 全部会话**。自定义档以 chip 排在第二行：点一下套用（只盖它那个范围），生效中再点一下取消；× 连点两次删除。范围是真的生效范围：会话档只在那条会话里盖住配置，工作区档管这个工作区下所有会话，全部会话档谁都用；优先级 **本会话 > 本工作区 > 全部会话**。有档生效时切点标题会写出是哪一档，点**保存**写回这个档而不是全局文件。内置预设只填草稿，点**保存**才生效。每个旋钮都是**滑块**（不是数字框）：拖动即改草稿，两端的刻度就是允许的上下限，滑块下面印「范围 … · 常用 …」——毫秒按 s/min/h 显示、比例按 % 显示。**滑块上不再出现 0**：有「关」这个状态的旋钮（大刀启用线、小刀回本轮数、动态刀长比例、净收益门槛）旁边多了个「启用」勾，取消勾选 = 关（写进去仍是 0），勾上回到一个能用的值；中刀启用线由组标题那个开关管。上下限都收进能用区间：大刀启用线 20 万–65 万、中刀启用线 10 万–65 万、两处冷却 1min 起（拖不到 0）、单刀 8k–128k、小刀下限 1k。**中刀是实验性功能**，排在最后、默认关闭；打开时要先看风险说明、勾「我明白风险」、再点**确认开启**，关掉永远是一键的（等价于 `deepCutAbove > 0`）；
6. **文档与出处**：README、更新记录可以直接**预览**（正文铺在行下面，最长 4 万字，超出会标注），路径一键复制；仓库 / 反馈是链接，版本只显示。宿主只肯打开工作区内的路径，插件目录在 profiles 下，所以这里不放注定失败的「打开」按钮；
7. **调试信息**：备份目录（只露路径尾巴）、会话 ID、**设置文件路径**、**配置通道状态**、按刀法摊开的计数、按旋钮名+单位摊开的生效设置（关着的项直接写「关」）；要原文有「复制计数 JSON / 复制设置 JSON」，默认收起。
8. **展开指示**：可展开的卡片标题右侧和时间线每一行末尾都有 ▸，展开后转成 ▾——不用猜哪里能点；
9. **顶栏「刷新」**：桌面版没有绑 Ctrl+R（应用菜单只留了 F12），改了插件文件后点它一下就能重新加载页面；F12 开发者工具里按 Ctrl+R / 控制台 `location.reload()` 同样可以。

刀法怎么认：

- `source.kind` 是 `spine-checkpoint` 的卡片按 `source.knife` 分**小刀** / **中刀**；1.3.14 之前写的卡没有这个字段，标成**旧卡片**（也是本插件切的，只是当时没记刀名）。
- `compact-checkpoint` 是官方摘要卡。本插件接管之后，官方摘要只有我们请它才会跑（决策日志里的 `official-handover`），所以卡片时间晚于「这条会话第一次被本插件碰到」的算**大刀**，早于它的算**官方**（插件接管之前的原生压缩）。
- 我方 = 小刀 + 中刀 + 大刀 + 旧卡片；官方只剩真正没经过本插件的那部分。

数据来自投影 `spine.cuts`（纯同步折叠会话事件）+ 只读的决策日志汇总；不额外开通道、不读会话内容。宿主没有投影能力时面板显示一行提示，压缩功能本身不受影响。

## 配置

优先级：**显式 config > 生效中的自定义档（本会话 > 本工作区 > 全部会话）> `~/.dsh/spine-settings.json` > 环境变量 > 默认值**。

面板上的旋钮**直接写这份文件**（`/api/dsh-live-compact-x-settings`）：保存成功会在旋钮卡下面写「已保存 HH:MM:SS」，失败把宿主返回的原因原样贴出来；通道连不上（老宿主 / 页面没刷新）时滑块停手并写明「配置通道不通」——不会再出现「点了没反应」。文件只在插件自己的路由里写，同源 + 回环校验，写之前校验键名与数值范围。

```json
{
  "minTokens": 20000,
  "keepRounds": 3,
  "chunkMax": 32000,
  "chunkMin": 1000,
  "bigGate": 650000,
  "minNetGain": 3000,
  "burstCuts": 3,
  "deepCutAbove": 0,
  "mergeMaxSpan": 4,
  "mergeBreakEven": 2,
  "officialAbove": 300000,
  "officialCooldownMs": 1200000,
  "paybackTurns": 0,
  "spanBandRatio": 0
}
```

| 键 | 环境变量 | 默认 | 说明 |
|---|---|---|---|
| `minTokens` | `SPINE_MIN_TOKENS` | 20000 | 低于这个不切 |
| `keepRounds` | `SPINE_KEEP_ROUNDS` | 3 | 最近几轮工具结果原文保留 |
| `chunkMax` | `SPINE_CHUNK_MAX` | 32000 | 单刀上限 |
| `chunkMin` | `SPINE_CHUNK_MIN` | 1000 | 单刀下限 |
| `bigGate` | `SPINE_BIG_GATE` | 650000 | 超过即停小切，交给大刀（**可按窗口大小调**） |
| `minNetGain` | `SPINE_MIN_NET_GAIN` | 3000 | 净收益门槛；0 = 关闭 |
| `burstCuts` | `SPINE_BURST_CUTS` | 3 | 一次收尾最多连切几刀 |
| `deepCutAbove` | `SPINE_DEEP_CUT_ABOVE` | **0（关闭）** | 中刀（卡片合并）开关；上下文超过它才试，本地建议 120000~200000 |
| `mergeMaxSpan` | `SPINE_MERGE_MAX_SPAN` | 4 | 中刀窗口上限 = chunkMax × 它（默认 128k）；太长的段不进中刀 |
| `mergeBreakEven` | `SPINE_MERGE_BREAK_EVEN` | 2 | 中刀盈亏上限：一次性重算 / 净赚 超过这个倍数就不切 |
| `mergeCooldownMs` | `SPINE_MERGE_COOLDOWN_MS` | 300000 | 两次中刀的最小间隔 |
| `paybackTurns` | `SPINE_PAYBACK_TURNS` | 0（关闭） | 小刀限速：一次性重算超过 净赚×轮数 就不切 |
| `spanBandRatio` | `SPINE_SPAN_BAND_RATIO` | 0（关闭） | 动态刀长：单刀上限 = 上下文 × 比例，夹在 chunkMin..chunkMax |
| `officialAbove` | `SPINE_OFFICIAL_ABOVE` | 0（示例 300000） | 超过它且无可切段时请官方大压缩；0 = 关 |
| `officialCooldownMs` | `SPINE_OFFICIAL_COOLDOWN_MS` | 1200000 | 两次大压缩的最小间隔 |
| — | `SPINE_STORE` | `v2` | 设 `v1` 回到上游影子副本路径 |
| — | `SPINE_SESSIONS_DIR` | `$DSH_HOME/sessions` | 会话日志根，v2 回读用 |
| — | `SPINE_SHADOW_MAX_MB` | 64 | v1 影子目录上限 |

`bigGate` 怎么定：窗口 1M 就留 650k；窗口 400k 建议 250k–300k。它只影响“小切何时停手”，大刀另有自己的阈值。

### 预设档与参考范围

不想一个个数字试，面板的切点卡里有四个内置按钮，点一下把值填进草稿（还要点保存；**中刀的旋钮不在任何预设里**）：

| 档 | 什么时候用 | 填什么 |
|---|---|---|
| 推荐档 | 日常首选 | 小刀常开、回本 8、刀长 6%、45 万请官方收 |
| 小刀优先 | 在意连续性，想让小刀多切几刀 | `officialAbove` 60 万、`spanBandRatio` 0（不按上下文缩刀长）、`paybackTurns` 4、`burstCuts` 4、`minNetGain` 2000 等 11 项 |
| 大刀优先 | 想压住上下文成本，接受更多摘要 | `officialAbove` 20 万、`spanBandRatio` 0.04、`paybackTurns` 10、`burstCuts` 1、`minNetGain` 4000、`minTokens` 30000 等 11 项 |

**＋ 自定义档**：把当前这套值（草稿优先，没改就是生效值）存成一个命名档，存的时候选范围：

| 范围 | 存在哪 | 谁吃 |
|---|---|---|
| 本会话 | `~/.dsh/spine-presets.json` → `session:<sid>` | 只有这条会话 |
| 本工作区 | 同上 → `workspace:<工作区目录名>` | 这个工作区下的所有会话（靠 `~/.dsh/sessions` 下的目录名认） |
| 全部会话 | 同上 → `all` | 谁都用 |

优先级 **本会话 > 本工作区 > 全部会话**，压过文件层但压不过显式 config。chip 点一下套用、再点取消；× 连点两次删除。有档在生效时切点标题会写出是哪一档，旋钮下面的**保存**会写回这个档（不是 `spine-settings.json`），所以调档不会误改别的会话。工作区目录名认不出来时，工作区那一档是灰的，面板会写明原因。

每个旋钮的参考区间（面板上每个输入框下面也印着）：

| 旋钮 | 范围 | 常用 |
|---|---|---|
| `minTokens` | 5k–200k | 20k–60k |
| `chunkMin` / `chunkMax` | 500–20k / 2k–128k | 1k–4k / 16k–48k |
| `keepRounds` / `keepRoundTokens` | 1–10 / 8k–200k | 2–5 / 16k–48k |
| `bigGate` | 100k–1M | 400k–650k |
| `minNetGain` / `burstCuts` | 0–50k / 1–10 | 2k–8k / 1–4 |
| `paybackTurns` / `spanBandRatio` | 0–30 / 0–50% | 0–8 / 2%–12% |
| `officialAbove` / `officialCooldownMs` | 0–650k / **1min–2h** | 200k–450k / 10min–1h |
| 中刀四项 | 面板上有，但**先别动** | 默认关着（冷却同样最低 1 分钟） |

> 面板上的滑块不接受 0：要关就把旁边的「启用」勾掉（存进去是 0）。这样不会有人把「大刀启用线」拖到 0 又把刀开坏。

滑块的上下限就是硬边界：低于下限拖不动（冷却最低 1 分钟，避免每轮都压一次），高于上限也拖不动（大刀/中刀启用线 65 万封顶，再高在这台机器上没有意义）。

## 与上游的差异

| # | 改动 | 位置 |
|---|---|---|
| 1 | 净收益门槛（切掉 − 卡片 < 门槛就不切） | `netgain.js`、`index.js` |
| 2 | 影子上限默认 256MB → 64MB（v1 模式） | `shadow.js` |
| 3 | 零副本存储：索引 + 日志回读 + 修剪兜底 | `v2/`、`raw.js` |
| 4 | 连切（一次收尾多刀） | `index.js` |
| 5 | 大刀：跨轮扩段 / 官方大压缩交接 | `plan.js`、`index.js` |
| 6 | 文件层设置 `~/.dsh/spine-settings.json` | `settings.js` |
| 7 | 中刀：从卡片一路切到尾巴，窗口由 mergeMaxSpan 管 | `policy.js`、`index.js` |
| 8 | 动态策略层：动态刀长 / 回本门槛 | `policy.js` |
| 9 | 宿主注入的上下文快照不再当用户墙 | `notice.js`、`index.js` |
| 10 | 压缩面板：会话投影 `spine.cuts` + `conversation.view` 页签 | `projection.js`、`client.js` |
| 11 | 自定义档：本会话 / 本工作区 / 全部会话三层覆盖 | `presets.js`、`settings.js`、`index.js` |

## 存储模型（v2）

```
~/.dsh/compaction-spine/
  index.jsonl        # 每条工具结果一行：id / seq / session / sha16 / bytes
  fallback/          # 只有会被官方修剪器改写的那 ~2%，zstd 压缩
```

回读链路：`索引 → 按 seq 解会话日志帧 → 校验 sha16+bytes → 命中`；日志里只剩修剪标记时走 `fallback/`。
找不到会话日志就 fail-closed，不写副本、不碰 ACL。

## 回滚

- 立即失效：`SPINE_STORE=v1`（回到上游影子路径）；
- 彻底卸载：删掉依赖与 bundle 条目，重新启用 `compaction-basic`。

## 开发与测试

```powershell
node --check index.js
node test/netgain.test.mjs         # 6/6
node test/policy.test.mjs          # 21/21
node test/merge-span.test.mjs      # 34/34
node test/card-digest.test.mjs     # 16/16
node test/context-notice.test.mjs  # 17/17
node test/projection.test.mjs      # 49/49
node test/stats.test.mjs           # 29/29
node test/client-panel.test.mjs    # 84/84
node v2/test/v2.test.mjs <session.v4.jsonl.zstd>   # 23/23
node test/wire.test.mjs <session.v4.jsonl.zstd>    # 11/11
```

审查记录见 [REVIEW.md](REVIEW.md)。

## 许可

MIT。原始版权归 **MerkyorLynn**（`LICENSE` 中的 Copyright (c) 2026 Merkyor 保留不动）；
本 fork 的修改部分版权归 **Raysnows**。