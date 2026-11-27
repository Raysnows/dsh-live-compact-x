import {
  SPINE_PROJECTION_KEY, MAX_CUTS, KNOB_KEYS, knifeOf, spineProjectionDefinition,
  isOursOfficial, attributeCuts, countCuts,
} from "../../src/engine/projection.js";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL  " + n + " " + x); } };

const def = spineProjectionDefinition({ shadowDir: (sid) => "/shadow/" + sid });
const view0 = () => def.wire.view(def.init({ id: "empty" }, 0));
let state = def.init({ id: "session-1" }, 0);

const summary = (id, tokens, start, end, extra = {}) => ({
  type: "compaction/summary",
  seq: 10,
  time: 1000,
  data: { compactionId: id, shadowedRange: { start, end }, shadowedTokenCount: tokens, provider: "codearts-vision", model: "v4.1", ...extra },
});
const card = (id, kind, text, rawNames = [], source = {}) => ({
  type: "user/message",
  seq: 11,
  time: 1001,
  data: { source: { kind, compactionId: id, rawNames, ...source }, content: [{ type: "text", text }] },
});

console.log("1. 初始状态");
ok(def.key === SPINE_PROJECTION_KEY && SPINE_PROJECTION_KEY === "spine.cuts", "投影键 " + def.key);
ok(state.saved === 0 && state.cuts.length === 0 && state.sid === "session-1", "空状态带会话号");
ok(state.shadowDir === "/shadow/session-1", "影子目录 " + state.shadowDir);
ok(state.kinds.small === 0 && state.savedBy.official === 0, "四种刀法的计数从 0 开始");
ok(view0().kinds.big === 0 && view0().kinds.official === 0, "视图把大刀和官方分开计");

console.log("2. 一次小刀：summary + 卡片");
state = def.apply(state, summary("c1", 8000, 100, 140));
ok(state.cuts.length === 0 && state.pending.c1.tokens === 8000, "summary 先挂起，不急着记一笔");
state = def.apply(state, card("c1", "spine-checkpoint", "Spine extract. 旧内容摘录", ["raw-1.txt"], { knife: "small" }));
ok(state.cuts.length === 1 && state.cuts[0].kind === "small", "卡片落账，类型 small");
ok(state.cuts[0].start === 100 && state.cuts[0].end === 140 && state.cuts[0].tokens === 8000, "范围与 token 都记下");
ok(state.saved === 8000 && state.spine === 1 && state.official === 0, "累计 8k / 我方 1 / 官方 0");
ok(state.pending.c1 === undefined, "挂起项被消费掉");
ok(state.cuts[0].rawNames[0] === "raw-1.txt" && state.cuts[0].provider === "codearts-vision", "备份文件名与模型信息都在");
ok(state.kinds.small === 1 && state.savedBy.small === 8000, "小刀单独计数");

console.log("3. 中刀也是本插件的，但算另一把刀");
state = def.apply(state, summary("c1m", 50000, 141, 900));
state = def.apply(state, card("c1m", "spine-checkpoint", "Spine extract. 合并后的卡片", [], { knife: "merge" }));
ok(state.cuts.at(-1).kind === "merge", "knife=merge 记成中刀");
ok(state.kinds.merge === 1 && state.savedBy.merge === 50000, "中刀单独计数 " + state.savedBy.merge);
ok(state.spine === 2 && state.official === 0, "中刀仍算我方");

console.log("4. 老卡片没记刀名：只知道是本插件，不瞎猜");
state = def.apply(state, card("c1o", "spine-checkpoint", "Spine extract. 1.3.13 之前的卡片"));
ok(state.cuts.at(-1).kind === "plugin", "无 knife 字段记成 plugin：" + state.cuts.at(-1).kind);
ok(state.kinds.plugin === 1, "plugin 单独计数");
ok(knifeOf({ kind: "compact-checkpoint" }) === "official", "官方卡永远是大刀");
ok(knifeOf(undefined) === "plugin", "没有 source 不抛错");

console.log("5. 官方卡也记一笔，但不计成我方");
state = def.apply(state, summary("c2", 12000, 200, 260));
state = def.apply(state, card("c2", "compact-checkpoint", "</compacted-summary> 官方摘要"));
ok(state.cuts.at(-1).kind === "official", "类型 official");
ok(state.official === 1 && state.views === undefined && state.saved === 70000, "累计 70k，各计各的");
ok(state.kinds.official === 1 && state.savedBy.official === 12000, "官方单独计数");

console.log("6. 同一张卡回放两次只记一次");
const before = state;
state = def.apply(state, card("c2", "compact-checkpoint", "</compacted-summary> 官方摘要"));
ok(state === before, "重复卡片返回同一引用（零下游工作）");

console.log("7. 无关事件返回同一引用");
const unrelated = { type: "tool/result", seq: 12, data: {} };
ok(def.apply(state, unrelated) === state, "无关事件不动状态");
ok(def.apply(state, { type: "user/message", data: { source: { kind: "user" } } }) === state, "真人消息不动状态");

console.log("8. 没有 summary 的卡片也算一笔（token 记 0）");
state = def.apply(state, card("c3", "spine-checkpoint", "孤立卡片"));
ok(state.cuts.at(-1).tokens === 0, "缺 summary 时 tokens=0 而不是报错");

console.log("9. 预览截断");
const long = "预".repeat(500);
state = def.apply(state, summary("c4", 100, 1, 2));
state = def.apply(state, card("c4", "spine-checkpoint", long));
ok(state.cuts.at(-1).preview.length === 181 && state.cuts.at(-1).preview.endsWith("…"), "预览截到 180 字符 + 省略号");

console.log("10. 只保留最近 " + MAX_CUTS + " 刀");
for (let i = 0; i < MAX_CUTS + 6; i += 1) {
  state = def.apply(state, summary("cap" + i, 10, i, i + 1));
  state = def.apply(state, card("cap" + i, "spine-checkpoint", "cap " + i));
}
ok(state.cuts.length === MAX_CUTS, "条数封顶 " + state.cuts.length);
ok(state.cuts.at(-1).id === "cap" + (MAX_CUTS + 5), "保留的是最近的");
ok(state.kinds.plugin > MAX_CUTS, "计数不受 40 刀上限影响（" + state.kinds.plugin + "）");

console.log("11. 视图只吐客户端需要的字段");
const view = def.wire.view(state);
ok(view.cuts.length === MAX_CUTS && view.pending === undefined, "视图没有 pending");
const keys = Object.keys(view).sort().join(",");
ok(keys === "cuts,defaults,docs,firstActivity,global,kinds,official,saved,savedBy,settings,shadowDir,sid,spine,version", "字段集 " + keys);
ok(def.stateSchema.parse(state) === state && def.viewSchema.parse(view) === view, "无 zod 时 schema 原样放行（宿主只调 parse）");
ok(def.wire.view(state) === view, "什么都没变时复用同一个视图对象");

console.log("12. 设置与文档随视图下发");
{
  const knobs = { chunkMax: 32000, minNetGain: 3000, deepCutAbove: 120000, officialAbove: 220000 };
  const def4 = spineProjectionDefinition({
    settingsReader: () => knobs,
    docs: { readme: "C:/p/README.md", changelog: "C:/p/CHANGELOG.md", repo: "https://example.test/r", issues: "https://example.test/i" },
    version: "1.3.14-x.0",
  });
  const s = def4.apply(def4.init({ id: "s4" }, 0), summary("z", 1000, 1, 2));
  const v = def4.wire.view(s);
  ok(v.settings.chunkMax === 32000 && v.settings.deepCutAbove === 120000, "设置值原样下发");
  ok(v.settings.minNetGain === 3000, "文件层设置也带上");
  ok(KNOB_KEYS.every((key) => typeof v.settings[key] === "number"), "面板要的每个旋钮都有数（" + KNOB_KEYS.length + "）");
  ok(v.settings.mergeMaxSpan === 0, "没解析到的键给 0，不给 undefined");
  ok(v.docs.readme === "C:/p/README.md" && v.docs.version === "1.3.14-x.0", "文档路径与版本都在");
  ok(v.docs.repo === "https://example.test/r" && v.docs.issues === "https://example.test/i", "仓库与反馈地址都在");
  ok(v.docs.readmeExists === false && v.docs.changelogExists === false, "没探过就当作不在，不假装能打开");
  const def4b = spineProjectionDefinition({
    docs: { readme: "C:/p/README.md", changelog: "C:/p/CHANGELOG.md", readmeExists: true, changelogExists: false },
  });
  const v4b = def4b.wire.view(def4b.init({ id: "s4b" }, 0));
  ok(v4b.docs.readmeExists === true && v4b.docs.changelogExists === false, "探到哪个在就标哪个在");
  ok(def4b.viewSchema.parse(v4b) === v4b, "带存在标记的文档视图也能过 schema");
  ok(v.defaults && Object.values(v.defaults).every((n) => typeof n === "number"), "默认档的默认值也下发：15 个数");
  const defWithDefaults = spineProjectionDefinition({ defaults: { chunkMax: 32000, deepCutAbove: 0, keepRounds: 3 } });
  const dv = defWithDefaults.wire.view(defWithDefaults.init({ id: "s6" }, 0));
  ok(dv.defaults.chunkMax === 32000 && dv.defaults.deepCutAbove === 0, "默认值原样带上");
  ok(dv.defaults.minNetGain === 0, "没给的键补 0，面板不用猜");
  let boom = 0;
  const def5 = spineProjectionDefinition({ settingsReader: () => { boom += 1; throw new Error("no settings"); } });
  const v5 = def5.wire.view(def5.init({ id: "s5" }, 0));
  ok(v5.settings.chunkMax === 0 && boom === 1, "设置读不出来时退化成 0，不抛错");
}

console.log("13. 全部会话的汇总随视图下发");
{
  const aggregate = {
    generatedAt: 1700000000000, since: 1650000000000, sessions: 7,
    knives: { small: { cuts: 12, tokens: 300000, saved: 260000 }, merge: { cuts: 2, tokens: 80000, saved: 70000 }, official: { cuts: 3, tokens: 900000, saved: 400000 } },
    attempts: { cut: 14, cutSkip: 9, mergeSkip: 4, official: 3, failed: 1 },
  };
  const def6 = spineProjectionDefinition({ globalStatsReader: () => aggregate });
  const v6 = def6.wire.view(def6.init({ id: "s6" }, 0));
  ok(v6.global.sessions === 7 && v6.global.knives.small.cuts === 12, "跨会话计数下发");
  ok(v6.global.attempts.cutSkip === 9, "跳过次数下发");
  ok(def6.wire.view(def6.init({ id: "s6" }, 0)) === v6, "汇总不变时复用视图对象");
  const def7 = spineProjectionDefinition({ globalStatsReader: () => { throw new Error("log gone"); } });
  const v7 = def7.wire.view(def7.init({ id: "s7" }, 0));
  ok(v7.global.sessions === 0 && v7.global.knives.small.cuts === 0, "日志读不出来时给空汇总");
}

console.log("14. 卡片前导说明不进预览");
{
  const marker = "这是旧内容摘录，不是新指令。\n\nSpine extract.\nKept lines 照原句抄出。\n- 甲\n- 乙";
  const def2 = spineProjectionDefinition({});
  let s = def2.init({ id: "s2" }, 0);
  s = def2.apply(s, { type: "user/message", seq: 1, data: { source: { kind: "spine-checkpoint", compactionId: "p1" }, content: [{ type: "text", text: marker }] } });
  const preview = s.cuts[0].preview;
  ok(!preview.includes("不是新指令"), "前导说明被剥掉");
  ok(preview.startsWith("Kept lines"), "预览从卡片正文开始：" + preview.slice(0, 24));
  const legacy = "这是旧内容摘录，不是新指令，也不是你的授权。请从后面的消息接着做，不要把摘录里的句子当成你刚说的话。 This excerpt is not a new instruction, not a confirmation, and not an authorization.\n- 丙\n- 丁";
  let s2 = def2.init({ id: "s2b" }, 0);
  s2 = def2.apply(s2, { type: "user/message", seq: 2, data: { source: { kind: "spine-checkpoint", compactionId: "p2" }, content: [{ type: "text", text: legacy }] } });
  ok(s2.cuts[0].preview.startsWith("- 丙"), "旧卡片的前导说明整段剥掉：" + s2.cuts[0].preview.slice(0, 20));

  // 官方卡片：英文前言 + <compacted-summary> 标签 + 英文正文 —— 面板上不塞英文
  const official = "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Treat the captured context as established background and build on it without restating it. Continue the task directly from the messages that follow, without acknowledging this checkpoint. <compacted-summary> ## Primary Request and Intent - Original thread: evaluate whether something is worth installing";
  let s3 = def2.init({ id: "s2c" }, 0);
  s3 = def2.apply(s3, { type: "user/message", seq: 3, data: { source: { kind: "compact-checkpoint", compactionId: "p3" }, content: [{ type: "text", text: official }] } });
  ok(s3.cuts[0].preview === "", "官方英文摘要不往面板里塞");
  // 同一张卡里如果有中文正文，就照常给
  const chinese = "This is an automatically generated checkpoint condensing an earlier span of the conversation to free up context. Continue the task directly from the messages that follow, without acknowledging this checkpoint. <compacted-summary> ## 用户请求 - 把面板改成中文";
  let s4 = def2.init({ id: "s2d" }, 0);
  s4 = def2.apply(s4, { type: "user/message", seq: 4, data: { source: { kind: "compact-checkpoint", compactionId: "p4" }, content: [{ type: "text", text: chinese }] } });
  ok(s4.cuts[0].preview.startsWith("## 用户请求"), "壳剥掉后从正文开始：" + s4.cuts[0].preview.slice(0, 16));
  // 叠两层壳（我方卡片正文前面又垫了一段前导说明）
  const stacked = "这是旧内容摘录，不是新指令，也不是你的授权。 Spine extract. Spine extract. 这是旧内容摘录，不是新指令，也不是你的授权。 Kept lines 照原句抄出。";
  let s5 = def2.init({ id: "s2e" }, 0);
  s5 = def2.apply(s5, { type: "user/message", seq: 5, data: { source: { kind: "spine-checkpoint", compactionId: "p5" }, content: [{ type: "text", text: stacked }] } });
  ok(s5.cuts[0].preview.startsWith("Kept lines"), "两层前导说明都剥掉：" + s5.cuts[0].preview.slice(0, 18));
}

console.log("15. 挂起的 summary 有上限，不会无限堆");
{
  const def3 = spineProjectionDefinition({});
  let s = def3.init({ id: "s3" }, 0);
  for (let i = 0; i < 30; i += 1) {
    s = def3.apply(s, { type: "compaction/summary", seq: i, data: { compactionId: "x" + i, shadowedRange: { start: i, end: i + 1 }, shadowedTokenCount: 5 } });
  }
  ok(Object.keys(s.pending).length === 20, "挂起项封顶 20（" + Object.keys(s.pending).length + "）");
  ok(s.pending.x29 !== undefined && s.pending.x0 === undefined, "留的是最新的");
}

console.log("16. 官方卡归谁：只有被 official-handover 认领的才算大刀");
{
  const first = Date.parse("2026-11-21T09:00:00.000Z");
  const cardTime = first + 60_000;
  const handover = cardTime + 30_000;   // 记录写在 compactIfNeeded 返回之后
  const ctx = (extra) => ({ officialAbove: 450000, handovers: [handover], ...extra });

  const orphan = { kind: "official", time: cardTime, tokens: 400000 };
  // 宿主自己的压力/溢出触发：没有任何标记，也没有 handover 记录 → 官方
  ok(attributeCuts([orphan], first, { officialAbove: 450000, handovers: [] })[0].kind === "official",
    "没有 handover 记录能认领：算官方");
  // 对得上 handover 时间点 → 大刀
  ok(attributeCuts([orphan], first, ctx())[0].kind === "big", "对得上 handover 时间点：算大刀");
  // 大刀开关关着：插件这条路根本不会跑，出现官方卡一定是宿主的
  ok(attributeCuts([orphan], first, { officialAbove: 0, handovers: [handover] })[0].kind === "official",
    "officialAbove=0：即使有 handover 记录也算官方");
  // 命令触发优先于一切
  const manual = { kind: "official", time: cardTime, tokens: 508657, sourceCommandId: "cmd-594e58c7-1" };
  ok(attributeCuts([manual], first, ctx())[0].kind === "official", "手动 /compact 带 sourceCommandId：算官方");
  // 时差超过窗口：认不了
  ok(attributeCuts([{ kind: "official", time: cardTime - 400_000, tokens: 1000 }], first, ctx())[0].kind === "official",
    "卡片比 handover 早超过 300 秒：不算大刀");
  // 卡片晚于 handover：不是这一刀
  ok(attributeCuts([{ kind: "official", time: handover + 1000, tokens: 1000 }], first, ctx())[0].kind === "official",
    "卡片晚于 handover：不算大刀");
  // 一条记录只能认领一张卡
  const two = attributeCuts([
    { kind: "official", time: cardTime, tokens: 1000 },
    { kind: "official", time: cardTime + 5000, tokens: 2000 },
  ], first, ctx());
  ok(two.filter((cut) => cut.kind === "big").length === 1, "一条 handover 记录只认领一张卡");

  ok(attributeCuts([{ kind: "small", time: cardTime, tokens: 8000 }], first, { officialAbove: 0, handovers: [] })[0].kind === "small",
    "小刀不受归因改动影响");

  ok(isOursOfficial(cardTime, first, "", ctx()), "isOursOfficial：卡片早于 handover 且在窗口内");
  ok(!isOursOfficial(handover + 1000, first, "", ctx()), "isOursOfficial：卡片晚于 handover 不算");
  ok(!isOursOfficial(0, first, "", ctx()), "isOursOfficial：没有卡片时间不瞎认");

  // 计数：一张大刀 + 一张接管前的官方
  const mixed = attributeCuts(
    [orphan, { kind: "official", time: first - 3600_000, tokens: 5000 }],
    first,
    ctx(),
  );
  ok(mixed[0].kind === "big" && mixed[1].kind === "official", "同一会话里大刀与官方可以并存");
  const counted = countCuts({ kinds: { official: 2 }, savedBy: { official: 405000 } }, mixed);
  ok(counted.kinds.big === 1 && counted.kinds.official === 1, "计数按归属分开");
  ok(counted.savedBy.big === 400000 && counted.savedBy.official === 5000, "切掉量也跟着分");
  // 40 刀上限之外的历史：原始计数比看得见的多，多出来的保守记官方
  const capped = countCuts({ kinds: { official: 5 }, savedBy: { official: 900000 } }, mixed);
  ok(capped.kinds.big === 1 && capped.kinds.official === 4, "上限之外的历史记成官方（" + capped.kinds.official + "）");
  ok(capped.savedBy.official === 500000, "切掉量补回：" + capped.savedBy.official);
}

console.log("16a. 宿主自触发的官方压缩不再被算成大刀（真实会话回归）");
{
  // 复刻 session-bd34b3a5：两张官方卡，插件从未 official-handover
  const first = Date.parse("2026-11-27T03:45:43.563Z");
  const early = { kind: "official", time: Date.parse("2026-11-27T02:28:04.040Z"), tokens: 370904 };
  const late = { kind: "official", time: Date.parse("2026-11-27T11:36:20.105Z"), tokens: 184265 };
  const list = attributeCuts([early, late], first, { officialAbove: 0, handovers: [] });
  ok(list[0].kind === "official", "早于首次活动的官方卡：官方");
  ok(list[1].kind === "official", "晚于首次活动、但没有 handover 记录：仍是官方（旧版会误判大刀）");
  const counted = countCuts({}, list);
  ok(counted.kinds.big === 0, "大刀计数为 0（实际 " + counted.kinds.big + "）");
  ok(counted.kinds.official === 2, "两张都记官方");
  ok(counted.savedBy.official === 370904 + 184265, "切掉量全部归官方");
}

console.log("16b. 卡片上的 sourceCommandId 进到 cuts，供归因使用");
{
  const d = spineProjectionDefinition({});
  let s = d.init({ id: "s16b" }, 0);
  s = d.apply(s, {
    type: "compaction/summary", seq: 1, time: 1000,
    data: { compactionId: "m1", shadowedRange: { start: 1, end: 2 }, shadowedTokenCount: 509000 },
  });
  s = d.apply(s, {
    type: "user/message", seq: 2, time: 1000,
    data: {
      source: { kind: "compact-checkpoint", compactionId: "m1", sourceCommandId: "cmd-594e58c7-1" },
      content: [{ type: "text", text: "summary" }],
    },
  });
  ok(s.cuts.length === 1, "卡片落到 cuts");
  ok(s.cuts[0].sourceCommandId === "cmd-594e58c7-1", "sourceCommandId 被保留：" + s.cuts[0].sourceCommandId);
  ok(attributeCuts(s.cuts, 1)[0].kind === "official", "该卡片归因为官方而不是大刀");
}

console.log("17. 视图里带着首次活动时间与大刀认领表");
{
  const first = Date.parse("2026-11-21T09:00:00.000Z");
  const cardTime = first + 1000;
  const aggregate = {
    generatedAt: 1, since: first, sessions: 1,
    knives: { small: { cuts: 0, tokens: 0, saved: 0 }, merge: { cuts: 0, tokens: 0, saved: 0 }, big: { cuts: 1, tokens: 500000, saved: 400000 } },
    attempts: { cut: 0, cutSkip: 0, mergeSkip: 0, official: 1, failed: 0 },
    firstBySid: { "session-abc": first },
    officialHandovers: { "session-abc": [cardTime + 30_000] },
  };
  // officialAbove 必须 > 0：开关关着时插件不可能发起大刀。
  const d = spineProjectionDefinition({
    globalStatsReader: () => aggregate,
    settingsReader: () => ({ officialAbove: 450000 }),
  });
  let s = d.init({ id: "session-abc" }, 0);
  s = d.apply(s, { type: "compaction/summary", seq: 1, time: cardTime, data: { compactionId: "x", shadowedRange: { start: 1, end: 9 }, shadowedTokenCount: 700, provider: "p", model: "m" } });
  s = d.apply(s, { type: "user/message", seq: 2, time: cardTime, data: { source: { kind: "compact-checkpoint", compactionId: "x" }, content: [{ type: "text", text: "官方摘要" }] } });
  const v = d.wire.view(s);
  ok(v.firstActivity === first, "视图带首次活动时间");
  ok(v.cuts[0].kind === "big" && v.kinds.big === 1 && v.kinds.official === 0, "能被 handover 认领的卡片归到大刀");

  // 同一批数据、但会话名对不上时不该乱认
  let s2 = d.init({ id: "other-session" }, 0);
  s2 = d.apply(s2, { type: "compaction/summary", seq: 1, time: cardTime, data: { compactionId: "y", shadowedRange: { start: 1, end: 9 }, shadowedTokenCount: 700 } });
  s2 = d.apply(s2, { type: "user/message", seq: 2, time: cardTime, data: { source: { kind: "compact-checkpoint", compactionId: "y" }, content: [{ type: "text", text: "x" }] } });
  const v2 = d.wire.view(s2);
  ok(v2.firstActivity === 0 && v2.cuts[0].kind === "official", "没记录的会话仍算官方");

  // 同一个会话、有卡片但没有 handover 记录：宿主自己压的，算官方
  const d3 = spineProjectionDefinition({
    globalStatsReader: () => ({ ...aggregate, officialHandovers: {} }),
    settingsReader: () => ({ officialAbove: 450000 }),
  });
  let s3 = d3.init({ id: "session-abc" }, 0);
  s3 = d3.apply(s3, { type: "compaction/summary", seq: 1, time: cardTime, data: { compactionId: "z", shadowedRange: { start: 1, end: 9 }, shadowedTokenCount: 700 } });
  s3 = d3.apply(s3, { type: "user/message", seq: 2, time: cardTime, data: { source: { kind: "compact-checkpoint", compactionId: "z" }, content: [{ type: "text", text: "x" }] } });
  const v3 = d3.wire.view(s3);
  ok(v3.cuts[0].kind === "official" && v3.kinds.big === 0, "宿主自触发的官方压缩：算官方");

  // 开关关着时，即使有 handover 记录也不认
  const d4 = spineProjectionDefinition({
    globalStatsReader: () => aggregate,
    settingsReader: () => ({ officialAbove: 0 }),
  });
  let s4 = d4.init({ id: "session-abc" }, 0);
  s4 = d4.apply(s4, { type: "compaction/summary", seq: 1, time: cardTime, data: { compactionId: "w", shadowedRange: { start: 1, end: 9 }, shadowedTokenCount: 700 } });
  s4 = d4.apply(s4, { type: "user/message", seq: 2, time: cardTime, data: { source: { kind: "compact-checkpoint", compactionId: "w" }, content: [{ type: "text", text: "x" }] } });
  const v4 = d4.wire.view(s4);
  ok(v4.cuts[0].kind === "official" && v4.kinds.big === 0, "officialAbove=0：不认大刀");
}

console.log("18. 升级容错：旧快照不被 schema 挡住");
{
  // 宿主那边的 zod 在 profile 里；本仓库自己没装，测不到就跳过。
  // zod 不在本仓库依赖里：先按正常解析找，再退到 profile 目录，都找不到就跳过。
  const pick = (m) => m.z ?? m.default?.z ?? m.default ?? m;
  const zod = await import("zod").then(pick).catch(() => null)
    ?? await import("file:///" + process.env.SPINE_ZOD_PATH).then(pick).catch(() => null);
  const def18 = spineProjectionDefinition({ zod });
  if (!zod) {
    console.log("  skip  没装 zod，跳过");
  } else {
    // 1.3.13 那版：没有 global / settings / docs / kinds，kind 还是 "spine"
    const oldView = {
      version: 1, saved: 100, spine: 1, official: 0, sid: "s", shadowDir: "/d",
      cuts: [{ id: "a", kind: "spine", start: 1, end: 2, tokens: 100, time: 1, provider: "", model: "", preview: "", rawNames: [] }],
    };
    let okOld = true;
    try { def18.viewSchema.parse(oldView); } catch { okOld = false; }
    ok(okOld, "1.3.13 的视图（无 global/settings/kinds，kind=spine）仍能过");
    const oldState = { version: 1, saved: 1, spine: 1, official: 0, sid: "s", shadowDir: "/d", cuts: [], pending: {} };
    let okOldState = true;
    try { def18.stateSchema.parse(oldState); } catch { okOldState = false; }
    ok(okOldState, "1.3.13 的状态（无 kinds/savedBy）仍能过");
    const bigView = JSON.parse(JSON.stringify(def18.wire.view(def18.init({ id: "s" }, 0))));
    bigView.cuts = [{ id: "z", kind: "big", start: 1, end: 2, tokens: 9, time: 1, provider: "", model: "", preview: "", rawNames: [] }];
    bigView.kinds = { ...(bigView.kinds || {}), big: 1 };
    let okBig = true;
    try { def18.viewSchema.parse(bigView); } catch { okBig = false; }
    ok(okBig, "新刀法 kind=big 不会被 enum 挡住");
    const newView = def18.wire.view(def18.init({ id: "s" }, 0));
    let okNew = true;
    try { def18.viewSchema.parse(newView); } catch (error) { okNew = String(error && error.message).slice(0, 60); }
    ok(okNew === true, "新版视图自己也能过：" + okNew);
  }
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);