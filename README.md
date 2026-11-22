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
> 账是这样算的：切完之后请求里只剩“新卡片 + 尾巴那几轮”，被吃掉的那一段不再进请求，前缀缓存照旧命中，
> 所以一次中刀的重算面通常只有几 k，而省下的往往是几十 k（实测 253k 的会话：切 118k、重算 16k、净赚 108k）。

## 安装

```
plugin_manager: install_bundle(target: "dsh-live-compact-x@1.3.10-x.0")
```

装完重启宿主。它的 `cordis.patch.yml` 会先禁用官方 `compaction-basic` 的**插件安装位**，再插入自己。

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

装好后会话页签会多一个**压缩**（在「上下文」和「编队」之间）：

顶部一层是**范围切换**：

- **本会话**：这条会话切过什么；
- **全部会话**：读 shadow 根目录那份决策日志（`spine-decisions.jsonl`），汇总所有会话的刀数与刀数占比。

内容从上到下：

1. **指标**：累计切掉、切刀数、我方卡片（小刀+中刀+旧卡）、官方卡片、最大一刀（本会话）/ 最多刀法（全部会话）、最近一刀；
2. **压缩构成条**：按刀法着色（小刀蓝 / 中刀紫 / 大刀橙 / 官方灰 / 旧卡青），悬停看范围与切掉量，图例带占比；
3. **刀法统计**：每种刀各切了几刀、切掉多少、占多少、平均一刀多大；
4. **时间线**：刀法徽标、切掉量、事件号范围、模型、时间、备份文件数；展开看卡片预览和备份文件名，路径一键复制；
5. **文档与出处**：README、更新记录、仓库、反馈地址、版本，都能一键复制；
6. **切点**（默认折叠，点一下展开）：小刀 / 大刀 / 中刀三组 15 个旋钮，和设置页同一份配置，改完点保存才生效。展开后第一行是**默认档**（一键填回引擎默认值）和**自定义档**（清掉草稿回到已保存的那套）。**中刀是实验性功能，排在最后、默认关闭**，开关就是组标题下的那个勾选（等价于 `deepCutAbove > 0`）；
7. **调试信息**：备份目录、会话 ID、原始计数与生效设置，默认收起。

刀法怎么认：

- `source.kind` 是 `spine-checkpoint` 的卡片按 `source.knife` 分**小刀** / **中刀**；1.3.14 之前写的卡没有这个字段，标成**旧卡片**（也是本插件切的，只是当时没记刀名）。
- `compact-checkpoint` 是官方摘要卡。本插件接管之后，官方摘要只有我们请它才会跑（决策日志里的 `official-handover`），所以卡片时间晚于「这条会话第一次被本插件碰到」的算**大刀**，早于它的算**官方**（插件接管之前的原生压缩）。
- 我方 = 小刀 + 中刀 + 大刀 + 旧卡片；官方只剩真正没经过本插件的那部分。

数据来自投影 `spine.cuts`（纯同步折叠会话事件）+ 只读的决策日志汇总；不额外开通道、不读会话内容。宿主没有投影能力时面板显示一行提示，压缩功能本身不受影响。

## 配置

优先级：**显式 config > `~/.dsh/spine-settings.json` > 环境变量 > 默认值**。

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