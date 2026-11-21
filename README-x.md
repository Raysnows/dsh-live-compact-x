# dsh-live-compact-x

仓库：<https://github.com/1250589385/dsh-live-compact-x> ｜ 当前 commit 见 `git log`

上游 [dsh-live-compact](https://github.com/Tranquillitatis-Lab/dsh-live-compact) 1.1.12 的 fork，只改三处，针对本机实测出来的两个毛病：**碎切** 和 **备份上限过大**。

## 改了什么

| # | 位置 | 改动 | 理由 |
|---|---|---|---|
| 1 | `netgain.js`（新增）+ `index.js:841` 附近 | 加净收益门槛：`切掉的 token − 卡片 token < minNetGain` 就**不切** | 上游只检查毛收益 `gain >= chunkMin (1000)`，但卡片常有 1000–8000 token。本机实测同一轮连切 4 刀、每刀 2.5–3.8K、净赚 1–2K。46 会话模拟：无门槛 1,847 刀，有门槛 388 刀 |
| 2 | `settings.js` | 新增 `minNetGain` 默认 **3000**，环境变量 `SPINE_MIN_NET_GAIN` | 可调；设 0 即恢复上游行为 |
| 3 | `shadow.js:2507` | 影子上限默认 **256MB → 64MB** | 本机全部历史原文才 33MB；256MB 只是让淘汰更晚、备份更多。仍可用 `SPINE_SHADOW_MAX_MB` 覆盖 |

包名、bundle 行 id、client 模块 id 都已改成 `dsh-live-compact-x`，不会和上游冲突，可以并装对照。

## 配置

```powershell
$env:SPINE_MIN_NET_GAIN = "4000"   # 净收益门槛，0 = 关闭（回到上游行为）
$env:SPINE_SHADOW_MAX_MB = "64"    # 影子目录上限
```

建议值：
- 短对话为主（每轮 1–5K）：**4000**，能把碎切压到几乎不发生；
- 长会话/大窗口：**3000**（默认）；
- 只想验证上游行为：**0**。

## 安装

```
plugin_manager: install_bundle(target: "D:\deepseek-workspaces\work\plugins\dsh-live-compact-x")
```

它的 `cordis.patch.yml` 会先禁用官方 `compaction-basic`，再插入自己这一行——这是上游的设计，不是本 fork 加的。

**回滚**：卸载该插件，重新启用 `compaction-basic` 即可；已产生的卡片留在会话日志里，原文在 `~/.dsh/compaction-spine/shadow`。

## 验证

```powershell
node --check index.js
node test\netgain.test.mjs      # 6/6
```

装上后跑一轮，卡片数量应明显少于上游；`dsh-live-compact stats` 的 `rewrite` 次数同步下降。

## 没做的（留给 v2）

1. **懒捕获**：现在仍是每条 tool/result 都写影子（与是否会被切无关），这是"双份占用"的根；
2. **打包 + 压缩**：一 blob 两文件、明文存储，3.4 万 inode；
3. **引用驱动回收**：仍按 mtime 删最老，卡片还在但原文可能被删。

这三项都要动 shadow/raw 的核心路径，建议先在真实会话里跑一周门槛改动，确认不炸再上。

## 已知风险

- 门槛抬高 → 单次切得少 → 上下文更容易撞 65 万硬停线（`bigGate`），之后完全不再切，靠官方压缩；
- 未运行上游 `test/` 全套（需要 devDependencies 的宿主包），只做了语法检查 + netgain 单测；
- 上游的 37 个 issue 原样继承。

## v2 存储层（已接线，默认开启）

`v2/` 下五个模块，独立可测，目标是把「副本」换成「索引 + 回读」：

| 模块 | 作用 |
|---|---|
| `index-store.js` | 每条结果一行元数据（id/seq/session/sha/bytes），seq 优先查找 |
| `log-reader.js` | zstd 多帧增量索引 + LRU 解码，按 seq 从日志回读原文 |
| `fallback-store.js` | 只存会被修剪器改写的那 ~2%，zstd 压缩 |
| `prune-hook.js` | 在修剪器动手之前抓原文 |
| `recall.js` | 索引 → 日志 → 兜底，sha16 + bytes 双校验 |

实测（24 会话 / 16,737 条 / 28.9MB）：召回 3000/3000 = 100%，索引 2.68MB，兜底 0.2MB，
日志召回 p50 0.157ms。详见 `REVIEW.md`。

接线还没做：`raw.js` 仍走上游影子路径，`package.json` 的 `files` 也还没加 `v2`。

## 存储后端开关

| 变量 | 默认 | 作用 |
|---|---|---|
| `SPINE_STORE` | `v2` | 设 `v1` 回到上游影子路径（每个结果写一份正文副本） |
| `SPINE_SESSIONS_DIR` | `$DSH_HOME/sessions` | 会话日志根；v2 按 `<slug>/<session-id>/session.v4.jsonl.zstd` 回读 |
| `SPINE_MIN_NET_GAIN` | 3000 | 净收益门槛；0 = 关闭 |

v2 失败一律 fail-closed：找不到会话日志就返回 `missing-session-log`，不写影子文件、不碰 ACL。
被官方修剪器改写的正文，由 `prune-hook` 在改写前压一份进 `<shadow>/../fallback/`。

回滚：设 `SPINE_STORE=v1` 重启；或卸载插件。

## 大刀 + 小刀

| 变量 | 默认 | 作用 |
|---|---|---|
| `SPINE_BURST_CUTS` | 3 | 一次收尾最多连切几刀（之前非 drain 会话只切 1 刀） |
| `SPINE_DEEP_CUT_ABOVE` | 200000 | 超过这个 token，后续刀允许跨过早先 user 消息 |
| `SPINE_OFFICIAL_ABOVE` | 0（关） | 超过这个 token 且无可切小段时，主动请官方大压缩压一次 |
| `SPINE_OFFICIAL_COOLDOWN_MS` | 1200000 | 两次官方大压缩的最小间隔 |

为什么需要大压：卡片是切点，也是**墙**。每切一刀就多一张卡，而选段不允许跨过最新的卡，
所以"可切段"永远只有卡之后的那一条尾巴——重负载时它只有几 k，小刀追不上增长。
官方大压缩能把这堆卡一并压掉（代价是一次 LLM 调用 + 一次前缀重算）。
