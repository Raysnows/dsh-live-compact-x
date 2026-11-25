# 仓库结构

> 一句话：根目录只放"宿主会直接找的东西"，实现按职责进 `src/`，测试按"要不要真会话"分开。
> 为什么这么分，见下面每一节；改完照着 `npm test` 跑一遍即可（干净 clone 也能跑）。

```
shell.js            宿主入口（package.json 的 main）
client.js           浏览器半边（宿主按约定从包根读）
cordis.patch.yml    接管官方 compaction-basic
src/engine/         引擎本体与切点选择
src/config/         设置、预设档、总开关、文档路径、面板桥
src/recall/         零副本回读（会话日志 → 卡片 seq）
bin/                dsh-live-compact stats / --version
test/unit/          纯函数与引擎单测
test/e2e/           面板渲染与回读链路
test/fixtures/      替身宿主包、临时目录助手
scripts/            发布与基准脚本（不进 npm 包）
docs/               架构说明（本文件）与审查记录
```

## src/engine/

| 文件 | 干什么 |
|---|---|
| `index.js` | 引擎本体：拦截 `compaction`、drain 收尾循环、小刀/中刀/大刀调度、决策日志 |
| `plan.js` | 选段与卡片：可切段、硬事实、结论、`seq` 回读提示 |
| `raw.js` | 原始工具结果查询入口（v1/v2 两条路） |
| `shadow.js` | 影子目录、cut 记录、决策文件轮转、统计 |
| `shadow-search.js` | 影子全文检索（`dsh-live-compact search` 用） |
| `shadow-save-worker.mjs` | 大文件落盘的工作线程 |
| `policy.js` | 净收益/回本/动态刀长这层判断 |
| `netgain.js` | 净收益公式（切掉 − 卡片） |
| `cooldown.js` | 官方压缩后的冷却窗口 |
| `thunder.js` | `SPINE_THUNDER` 实验开关（默认关） |
| `notice.js` | 宿主注入的上下文快照识别（不当用户墙） |
| `projection.js` | 面板用的会话投影 `spine.cuts` |
| `stats.js` | 全局统计与按刀法汇总 |
| `adapter.js` | 宿主包解析与兼容（compaction / compaction-basic / llm） |
| `gate.js` | 预设接管闸门；rc.12 下用 `Symbol.for("cordis.root")` 取 root |

## src/config/

| 文件 | 干什么 |
|---|---|
| `settings.js` | 默认值、环境变量、文件层、自定义档优先级；`stopLineFor()` 兜住收尾停止线 |
| `presets.js` | 自定义档读写（本会话 / 本工作区 / 全部会话），纳秒 mtime 缓存 |
| `switch.js` | 总开关（全局 + 单会话），原子写，纳秒 mtime 缓存 |
| `docs.js` | 文档路径（跟着包走）+ `parseChangelog()`（面板的"本版更新"） |
| `bridge.js` | 面板设置桥 `/api/dsh-live-compact-x-settings`：describe / save / switch / preset / diag / whatsnew / doc |

## src/recall/

零副本的关键：卡片只存 `seq`，原文永远从会话日志回读。

| 文件 | 干什么 |
|---|---|
| `log-reader.js` | `session.v4.jsonl.zstd` 多帧解码 + 全事件 seq 索引 |
| `index-store.js` | `index.jsonl`：id / seq / session / sha16 / bytes |
| `fallback-store.js` | 只有日志被修剪的那一小部分落 `fallback/` |
| `recall.js` | 回读 + sha16 校验 + 命中率统计 |
| `prune-hook.js` | 修剪发生前把要丢的那几段保住 |
| `store-switch.js` | v1 / v2 存储切换（`SPINE_STORE`） |
| `backend.js` | 把上面几件拼成一个后端 |

## 三条不能破的规则

1. **收尾停止线 ≥ 小刀一刀上限**：`max(keepRoundTokens, chunkMax)`。比一刀还低就是把同一刀拆成两刀。
2. **零副本**：卡片只拿 `seq`，不复制原文；只有日志已被修剪的段才落 `fallback/`，并如实写在卡片上。
3. **面板只读**：桥只写 `~/.dsh/spine-*.json`，诊断与更新日志只读文件，不联网。

## 测试怎么跑

```powershell
npm test                                  # unit/ + e2e/ 全跑，干净 clone 可用
node test/unit/policy.test.mjs            # 单个
node --experimental-loader ./test/fixtures/host-loader.mjs test/unit/big-method.test.mjs
SPINE_V2_FIXTURE=<session.v4.jsonl.zstd> npm test   # 用真实会话当夹具（可选）
```

`test/fixtures/temp.mjs` 会先试系统临时目录，写不进去（受限沙箱常见 EPERM）就退到仓库下的 `.test-tmp`。
