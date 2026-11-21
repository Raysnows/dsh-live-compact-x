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

> 还有一个**中刀**（卡片合并：吃掉几张旧卡重压成一张），默认**关闭**——它会让切点之后的缓存重算一次，属于“顶不住时才开”的档位。

## 安装

```
plugin_manager: install_bundle(target: "dsh-live-compact-x@1.3.9-x.0")
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
  "officialAbove": 300000,
  "officialCooldownMs": 1200000
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
| `deepCutAbove` | `SPINE_DEEP_CUT_ABOVE` | **0（关闭）** | 中刀（卡片合并）开关；设 200000 左右启用 |
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
node test/netgain.test.mjs        # 6/6
node v2/test/v2.test.mjs <session.v4.jsonl.zstd>   # 23/23
node test/wire.test.mjs <session.v4.jsonl.zstd>    # 11/11
```

审查记录见 [REVIEW.md](REVIEW.md)。

## 许可

MIT。原始版权归 **MerkyorLynn**（`LICENSE` 中的 Copyright (c) 2026 Merkyor 保留不动）；
本 fork 的修改部分版权归 **Raysnows**。