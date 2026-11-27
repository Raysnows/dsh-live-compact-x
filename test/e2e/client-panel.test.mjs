/** 浏览器半边：在假加载器里跑起来，验统计、验面板渲染、验注册。 */
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL  " + n + " " + x); } };

const inserted = [];
let captured = null;
globalThis.styles = { insert: (css) => inserted.push(css) };
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };

// React 极简替身：只要能把树建出来就够检查内容
const hooks = [];
const React = {
  createElement(type, props, ...children) {
    const flat = children.length === 1 && Array.isArray(children[0]) ? children[0] : children;
    return { type, props: props || {}, children: flat.flat().filter((c) => c !== null && c !== undefined && c !== false) };
  },
  useState(initial) {
    const slot = { value: typeof initial === "function" ? initial() : initial, sets: 0 };
    hooks.push(slot);
    return [slot.value, (next) => { slot.value = typeof next === "function" ? next(slot.value) : next; slot.sets += 1; }];
  },
  useRef(initial) { return { current: initial }; },
  useEffect(fn) { try { fn(); } catch {} },
  useSyncExternalStore(subscribe, getSnapshot) { void subscribe; return getSnapshot(); },
};

class SettingsFormModel {
  constructor(ledger, fields) { this.ledger = ledger; this.fields = fields; this.saved = 0; this.discarded = 0; this.edits = []; this.overrides = {}; }
  bind(selector) { return () => selector(); }
  shell() { return { writable: true, saving: false }; }
  // 宿主真实的 field() 契约：{ text, overridden, invalid }（没有 value 字段）。
  // 这里同时给 value，是为了让旧断言还能读到字符串。
  field(name) {
    const value = this.overrides[name];
    const text = value === undefined ? "" : String(value);
    return { text, value: text, overridden: value !== undefined, invalid: false };
  }
  actions() {
    return {
      edit: (name, text) => { this.edits.push([name, text]); },
      resetField() {},
      save: () => { this.saved += 1; },
      discard: () => { this.discarded += 1; },
    };
  }
  dispose() {}
}

const requireStub = (name) => {
  if (name === "react") return React;
  if (name === "@deepseek-ai/dsh-client-ui-primitives") {
    return {
      SettingsFormModel,
      settingsNumberField: (name) => ({ name }),
      SettingsForm: (props) => React.createElement("SettingsForm", props),
      SettingsValueField: (props) => React.createElement("SettingsValueField", props),
    };
  }
  throw new Error("unexpected require: " + name);
};

await import(new URL("../../client.js", import.meta.url).href);
ok(captured?.id === "dsh-live-compact-x", "加载器拿到插件 id");
const plugin = captured.factory(requireStub);
const T = plugin.__test;

console.log("1. 加载器契约");
ok(Array.isArray(plugin.inject) && plugin.inject.includes("slots"), "inject 里有 slots：" + plugin.inject.join("/"));
ok(typeof plugin.apply === "function", "有 apply");

console.log("2. 数字格式");
ok(T.fmtTokens(0) === "0" && T.fmtTokens(999) === "999", "小数字原样");
ok(T.fmtTokens(1500) === "1.5k" && T.fmtTokens(32000) === "32.0k", "千级一位小数：" + T.fmtTokens(32000));
ok(T.fmtTokens(150000) === "150k", "十万以上取整：" + T.fmtTokens(150000));
ok(T.fmtTokens(2500000) === "2.50M", "百万级：" + T.fmtTokens(2500000));
ok(T.fmtClock(0) === "—", "没有时间显示破折号");
ok(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(T.fmtClock(Date.now())), "时间格式 YYYY-MM-DD HH:mm:ss：" + T.fmtClock(Date.now()));

console.log("3. 刀法归类：老数据不许冒充小刀");
ok(T.kindOfCut({ kind: "small" }) === "small", "小刀认小刀");
ok(T.kindOfCut({ kind: "merge" }) === "merge", "中刀认中刀");
ok(T.kindOfCut({ kind: "official" }) === "official", "官方认官方");
ok(T.kindOfCut({ kind: "plugin" }) === "plugin", "旧卡认旧卡");
ok(T.kindOfCut({ kind: "spine" }) === "small", "1.3.13 之前的 spine 记成小刀");
ok(T.kindOfCut({}) === "plugin" && T.kindOfCut(null) === "plugin", "没有 kind 时不瞎猜，算旧卡");
ok(new Set(["small", "merge", "official", "plugin"].map((k) => T.KNIFE_COLOR[k])).size === 4, "四种刀法四种颜色");

console.log("4. 统计口径");
const cuts = [
  { id: "a", kind: "small", tokens: 4000, start: 10, end: 20, time: 1000, rawNames: ["f1"], model: "m" },
  { id: "b", kind: "official", tokens: 60000, start: 100, end: 900, time: 2000, rawNames: [], model: "m" },
  { id: "c", kind: "small", tokens: 0, start: 0, end: 0, time: 3000, rawNames: ["f2", "f3"], model: "" },
  { id: "d", kind: "merge", tokens: 80000, start: 200, end: 2000, time: 4000, rawNames: [], model: "m" },
  { id: "e", kind: "plugin", tokens: 5000, start: 0, end: 0, time: 5000, rawNames: [], model: "" },
  { id: "f", kind: "big", tokens: 400000, start: 300, end: 3000, time: 6000, rawNames: [], model: "m" },
];
const stats = T.summarizeCuts(cuts);
ok(stats.count === 6 && stats.total === 549000, "刀数与总量 " + stats.total);
ok(stats.byKind.small.cuts === 2 && stats.byKind.small.saved === 4000, "小刀单列 2 刀 / 4000");
ok(stats.byKind.merge.cuts === 1 && stats.byKind.merge.saved === 80000, "中刀单列 1 刀 / 80000");
ok(stats.byKind.official.cuts === 1 && stats.byKind.official.saved === 60000, "官方单列 1 刀 / 60000");
ok(stats.byKind.big.cuts === 1 && stats.byKind.big.saved === 400000, "大刀单列 1 刀 / 400000");
ok(stats.byKind.plugin.cuts === 1 && stats.byKind.plugin.saved === 5000, "旧卡单列 1 刀 / 5000");
ok(stats.spineCount === 5 && stats.spineTokens === 489000, "我方合计 = 小刀+中刀+大刀+旧卡（" + stats.spineTokens + "）");
ok(stats.officialCount === 1 && stats.officialTokens === 60000, "官方单独计");
ok(stats.average === 91500, "平均每刀 " + stats.average);
ok(stats.biggest.id === "f", "最大一刀是大刀 f");
ok(stats.files === 3, "备份文件总数 " + stats.files);
ok(stats.first.id === "a" && stats.last.id === "f", "首尾顺序按时间线");
ok(T.summarizeCuts([]).count === 0 && T.summarizeCuts(null).total === 0, "空输入不抛错");

console.log("5. 构成条");
const segs = T.barSegments(cuts);
ok(segs.length === 5, "0 token 的刀不进构成条");
ok(new Set(segs.map((s) => s.color)).size === 5, "五种刀法在条上颜色可分辨");
ok(Math.abs(segs.reduce((s, x) => s + x.share, 0) - 1) < 1e-9, "占比之和为 1");
ok(segs.every((x) => x.width > 0), "最小可见宽度 > 0");
ok(T.barSegments([{ tokens: 0 }, { tokens: 0 }]).length === 0, "全是 0 时没有构成条");
const kbars = T.kindBars([
  { kind: "small", saved: 50, color: "#1" },
  { kind: "merge", saved: 0, color: "#2" },
  { kind: "big", saved: 50, color: "#3" },
]);
ok(kbars.length === 2 && Math.abs(kbars[0].share - 0.5) < 1e-9, "按刀法汇总的构成条只算有量的");
ok(T.shareText(50, 100) === "50%" && T.shareText(1, 1000) === "0.10%" && T.shareText(0, 0) === "—", "占比文案 " + T.shareText(1, 1000));

console.log("6. 面板渲染（React 替身）");
// 真 React 会在此刻调用函数组件；替身也要展开展开，否则统计只停在壳上。
const walk = (node, visit) => {
  if (node === null || node === undefined || node === false) return;
  if (typeof node === "string" || typeof node === "number") { visit({ kind: "text", value: String(node) }); return; }
  if (Array.isArray(node)) { for (const item of node) walk(item, visit); return; }
  if (typeof node !== "object") return;
  visit({ kind: "node", node });
  if (typeof node.type === "function") { walk(node.type(node.props || {}), visit); return; }
  for (const child of node.children || []) walk(child, visit);
};
const texts = (tree) => { const out = []; walk(tree, (n) => { if (n.kind === "text") out.push(n.value); }); return out.join(" "); };
const fakeState = {
  saved: 549000, spine: 5, official: 1, shadowDir: "C:\\shadow\\s1", sid: "session-1",
  firstActivity: 1650000000000,
  kinds: { small: 2, merge: 1, plugin: 1, big: 1, official: 1 },
  savedBy: { small: 4000, merge: 80000, plugin: 5000, big: 400000, official: 60000 },
  settings: { chunkMax: 32000, chunkMin: 1000, burstCuts: 3, paybackTurns: 8, spanBandRatio: 0.06, minNetGain: 3000, deepCutAbove: 120000, mergeMaxSpan: 4, mergeBreakEven: 2, mergeCooldownMs: 300000, officialAbove: 220000, officialCooldownMs: 1200000, bigGate: 650000, keepRounds: 3, keepRoundTokens: 32000 },
  docs: { readme: "C:/p/README.md", changelog: "C:/p/CHANGELOG.md", repo: "https://example.test/r", issues: "https://example.test/i", version: "1.3.14-x.0" },
  global: {
    generatedAt: 1700000000000, since: 1650000000000, sessions: 7,
    knives: { small: { cuts: 12, tokens: 300000, saved: 260000 }, merge: { cuts: 2, tokens: 80000, saved: 70000 }, big: { cuts: 3, tokens: 900000, saved: 400000 } },
    attempts: { cut: 14, cutSkip: 9, mergeSkip: 4, official: 3, failed: 1 },
    firstBySid: { "session-1": 1650000000000 },
  },
  cuts,
};
const model = new SettingsFormModel({}, []);
const actions = model.actions();
const tree = T.SpinePanel({ t: (key) => key, useProjection: () => fakeState, model, actions });
const text = texts(tree);
ok(text.includes("549k"), "KPI 显示累计切掉：" + text.slice(0, 60));
ok(text.includes("91.5k"), "平均显示成 91.5k（549k / 6 刀）");
ok(text.includes("spine.scopeSession") && text.includes("spine.scopeAll"), "有本会话/全部会话的切换");
ok(text.includes("spine.knifeStats") && text.includes("spine.knifeMerge"), "有按刀法的统计块");
ok(text.includes("spine.docs") && text.includes("C:/p/README.md"), "文档卡显示 README 路径");
ok(text.includes("https://example.test/r"), "文档卡显示仓库地址");
ok(text.includes("1.3.14-x.0"), "文档卡显示版本");
const empty = T.SpinePanel({ t: (key) => key, useProjection: () => undefined });
ok(texts(empty).includes("spine.unavailable"), "没有投影时给提示而不是崩");
ok(!text.includes("SettingsValueField"), "面板不渲染宿主原语组件（它抛错会把槽位打成空白）");
// shell() 抛错时退化成只读，不该把整块面板打空
const throwing = { shell() { throw new Error("boom"); } };
const errTree = T.SpinePanel({ t: (key) => key, useProjection: () => fakeState, model: throwing, actions });
ok(!texts(errTree).includes("spine.error") && texts(errTree).includes("spine.cutPoint"), "shell 抛错时降级成只读，不白屏");
let errSave = null;
walk(errTree, (entry) => { const n = entry.node; if (n && n.props?.className === "sp-btn sp-btn-primary") errSave = n; });
ok(errSave && errSave.props.disabled === true, "降级后保存按钮是禁用的");
// 真出错（状态本身炸了）时给可见提示
const brokenState = { ...fakeState, get settings() { throw new Error("settings exploded"); } };
const broken = T.SpinePanel({ t: (key) => key, useProjection: () => brokenState, model, actions });
ok(texts(broken).includes("spine.error") && texts(broken).includes("settings exploded"), "渲染体抛错时给可见提示而不是空白");
// 投影钩子自己抛错，槽位也不能白
const hookBoom = T.SpinePanel({ t: (key) => key, useProjection: () => { throw new Error("projection gone"); }, model, actions });
ok(texts(hookBoom).includes("spine.error") && texts(hookBoom).includes("projection gone"), "投影钩子抛错也不白屏");

console.log("7. 面板结构：刀法徽标、调试台收起、刀把在后");
let rows = 0; let knobs = 0; let saveBtn = null; let debug = null; let badges = new Set(); let knobTitles = [];
walk(tree, (entry) => {
  const n = entry.node;
  if (!n) return;
  if (n.props?.className === "sp-row") rows += 1;
  if (typeof n.type === "function" && n.type.name === "KnobInput") { knobs += 1; knobTitles.push(n.props.label); }
  if (n.props?.className === "sp-btn sp-btn-primary") saveBtn = n;
  if (n.type === "details" && n.props?.className === "sp-details sp-card") debug = n;
  if (n.props?.className === "sp-badge") badges.add(n.props?.style?.color);
});
ok(rows === 6, "时间线六行（" + rows + "）");
ok(knobs === 15, "刀把共 15 个旋钮（" + knobs + "）");
ok(Boolean(saveBtn), "有保存按钮");
ok(debug !== null, "调试信息是一个 details");
ok(debug && !("open" in debug.props), "调试台默认不展开");
ok(badges.size === 5, "时间线上五种刀法徽标颜色不同（" + badges.size + "）");
let chevs = 0;
walk(tree, (entry) => {
  const n = entry.node;
  const cls = n && typeof n.props?.className === "string" ? n.props.className.split(" ") : [];
  if (cls.includes("sp-chev")) chevs += 1;
});
ok(chevs === 10, "可展开的地方都挂 ▸ 图标（3 张卡 + 6 行时间线 + 中刀组）：" + chevs);
ok(T.SPINE_CSS.includes(".sp-details[open]>summary .sp-chev{transform:rotate(90deg)}"), "展开后图标转 90°");
saveBtn?.props?.onClick?.();
ok(model.saved === 1, "没接配置桥时，保存仍然回落到宿主模型");

// 接上配置桥之后：保存必须真的把草稿交给桥，而不是调宿主的 save()。
let bridgeSaved = 0;
const bridgeStore = {
  save: () => { bridgeSaved += 1; return Promise.resolve(true); },
  discard() {}, edit() {}, reset() {}, setMany() {}, openDoc() {}, dirty: () => true,
};
const bridgeCfg = {
  status: "ready", draft: { minNetGain: "5000" }, effective: { minNetGain: 5000 },
  defaults: {}, fixed: {}, file: "C:/u/.dsh/spine-settings.json",
  saving: false, savedAt: 0, saveError: "", doc: null, docLoading: false,
};
const wiredTree = T.renderPanel({ t: (key) => key, model, actions }, fakeState, "session", () => {}, () => {}, undefined,
  { timelineAll: false, toggleTimeline() {}, cfg: bridgeCfg, store: bridgeStore });
let wiredSave = null;
let wiredKnob = null;
walk(wiredTree, (entry) => {
  if (entry.node?.props?.className === "sp-btn sp-btn-primary") wiredSave = entry.node;
  if (entry.node?.props?.["data-knob"] === "minNetGain" && entry.node?.props?.type === "range") wiredKnob = entry.node;
});
wiredSave?.props?.onClick?.();
ok(bridgeSaved === 1 && model.saved === 1, "接上桥后保存走桥，不再重复调宿主 save()");
ok(texts(wiredTree).includes("spine.cfgChannel"), "旋钮卡里有通道状态行");
ok(texts(wiredTree).includes("spine.draftPending"), "草稿没保存时如实标出来");
ok(wiredKnob && wiredKnob.props.value === "5000", "草稿值直接反映在滑块上（不再等宿主回写）");

const downCfg = { ...bridgeCfg, status: "unavailable", error: "HTTP 404" };
const downTree = T.renderPanel({ t: (key) => key, model, actions }, fakeState, "session", () => {}, () => {}, undefined,
  { timelineAll: false, toggleTimeline() {}, cfg: downCfg, store: bridgeStore });
let downKnob = null;
walk(downTree, (entry) => {
  if (entry.node?.props?.["data-knob"] === "minNetGain" && entry.node?.props?.type === "range") downKnob = entry.node;
});
ok(Boolean(downKnob) && downKnob.props.disabled !== true, "桥没连上时滑块仍可用（退回宿主表单）");
ok(texts(downTree).includes("HTTP 404"), "把桥失败的原因写出来");
ok(texts(downTree).includes("spine.cfgFallback"), "说明现在走的是宿主设置表单");

// 刀把必须是最后一张卡（中刀是实验性功能，放最后）
const sections = [];
walk(tree, (entry) => {
  const n = entry.node;
  if (!n) return;
  if (n.type === "details" && n.props?.className === "sp-details sp-card") {
    const head = (n.children || [])[0];
    const label = [];
    if (head) walk(head, (x) => { if (x.kind === "text") label.push(x.value); });
    if (label.length) sections.push(label[0]);
  }
  if (typeof n.type === "string" && String(n.props?.className || "").split(/\s+/).includes("sp-card")) {
    const title = (n.children || []).find((c) => c && c.props && c.props.className === "sp-card-title");
    const label = [];
    if (title) walk(title, (x) => { if (x.kind === "text") label.push(x.value); });
    if (label.length) sections.push(label[0]);
  }
});
const uniqueSections = sections.filter((s, i) => sections.indexOf(s) === i);
// 切点挪到第一屏（刀法统计右边），判据从「倒数第三」改成「在时间线与文档之前」。
ok(uniqueSections.indexOf("spine.cutPoint") < uniqueSections.indexOf("spine.timeline"),
  "切点排在时间线之前（打开就看得到）：" + uniqueSections.join("|"));
ok(uniqueSections.indexOf("spine.timeline") < uniqueSections.indexOf("spine.docs"), "文档与出处排在时间线之后：" + uniqueSections.join("|"));
ok(uniqueSections[uniqueSections.length - 1] === "spine.debug", "调试台在最后且收起：" + uniqueSections.join("|"));
ok(uniqueSections.filter((sec) => sec === "spine.cutPoint").length === 1, "切点卡只出现一次");
// 收起状态也要有信息：策略行只有一条
{
  let strategy = 0;
  walk(T.renderPanel({ t: (k) => k, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() }, fakeState, "session", () => {}, () => {}), ({ kind, node }) => {
    if (kind === "node" && node.props && node.props["data-strategy"] === "1") strategy += 1;
  });
  ok(strategy === 1, "切点卡收起时仍有一行当前策略（" + strategy + "）");
}
// 刀法统计与切点并排：同一块 .sp-duo 里两块卡片，窄屏退成一列。
{
  const duo = [];
  const duoTree = T.renderPanel({ t: (k) => k, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() }, fakeState, "session", () => {}, () => {});
  walk(duoTree, ({ kind, node }) => {
    if (kind !== "node" || !node.props) return;
    if (String(node.props.className || "").split(/\s+/).includes("sp-duo")) duo.push(node);
  });
  ok(duo.length === 1, "刀法统计与切点包在同一块并排容器里（" + duo.length + "）");
  const css = String(T.SPINE_CSS);
  ok(css.includes(".sp-duo{display:grid"), "并排容器用 grid");
  ok(css.includes("@media (max-width:760px){.sp-duo{grid-template-columns:1fr}}"), "窄屏退成一列");
  ok(css.includes(".sp-duo>.sp-card{margin-bottom:0}"), "并排里的卡片不再各留一条外边距");
}
// 信息密度：卡片内边距与 KPI 间距都收紧过，值写死——改样式时这里会提醒。
ok(String(T.SPINE_CSS).includes("padding:8px 10px"), "卡片内边距收紧到 8px/10px");
ok(String(T.SPINE_CSS).includes("minmax(106px,1fr)"), "KPI 最小宽度收到 106px");
const knobOrder = T.KNOB_GROUPS.map((g) => g.id).join(",");
ok(knobOrder === "small,big,script,mid", "本地脚本组排在刀法之后、实验性中刀之前（" + knobOrder + "）");
ok(T.KNOB_GROUPS.find((g) => g.id === "mid").experimental === true, "中刀标了实验性");
ok(T.KNOB_GROUPS.find((g) => g.id === "mid").enable === "deepCutAbove", "中刀有独立开关（deepCutAbove）");

console.log("8. 实验性开关：开要二次确认，关是一键");
const midOff = { ...fakeState, settings: { ...fakeState.settings, deepCutAbove: 0 } };
const checkboxes = (tree) => {
  const found = [];
  // 只认面板自己的开关：旋钮那排「启用」勾带 data-knob，属于配置项，不是这里要找的开关。
  walk(tree, (entry) => {
    const n = entry.node;
    if (n && n.type === "input" && n.props?.type === "checkbox" && !n.props["data-knob"]) found.push(n);
  });
  return found;
};
const buttonsOf = (tree, label) => {
  const found = [];
  walk(tree, (entry) => {
    const n = entry.node;
    if (!n || n.type !== "button") return;
    const text = [];
    walk(n, (x) => { if (x.kind === "text") text.push(x.value); });
    if (text.join("") === label) found.push(n);
  });
  return found;
};
{
  // 关着的时候点开关：只弹确认，不写配置
  const modelA = new SettingsFormModel({}, []);
  const callsA = { open: 0, close: 0 };
  const treeA = T.renderPanel({ t: (key) => key, model: modelA, actions: modelA.actions() }, midOff, "session", () => {}, () => {},
    { ask: false, ack: false, open: () => { callsA.open += 1; }, close: () => { callsA.close += 1; }, setAck: () => {} });
  const swA = checkboxes(treeA)[0];
  ok(Boolean(swA), "有中刀开关");
  ok(swA.props.checked === false, "deepCutAbove=0 时开关是关的");
  swA.props.onChange({ target: { checked: true } });
  ok(callsA.open === 1 && modelA.edits.length === 0, "打开只弹确认，不直接改 deepCutAbove");
  ok(buttonsOf(treeA, "spine.midConfirm").length === 0, "没弹确认时没有确认按钮");
  // 弹了确认框：没勾「我明白」，确认按钮禁用
  const modelB = new SettingsFormModel({}, []);
  const treeB = T.renderPanel({ t: (key) => key, model: modelB, actions: modelB.actions() }, midOff, "session", () => {}, () => {},
    { ask: true, ack: false, open: () => {}, close: () => {}, setAck: () => {} });
  const confirmB = buttonsOf(treeB, "spine.midConfirm")[0];
  ok(Boolean(confirmB), "确认框给出确认开启");
  ok(confirmB.props.disabled === true, "没勾「我明白」时确认按钮禁用");
  ok(texts(treeB).includes("spine.midWarnBody"), "确认框里有风险说明");
  // 勾了以后点确认：才真的写 deepCutAbove 并收起确认框
  const modelC = new SettingsFormModel({}, []);
  let closedC = 0;
  const treeC = T.renderPanel({ t: (key) => key, model: modelC, actions: modelC.actions() }, midOff, "session", () => {}, () => {},
    { ask: true, ack: true, open: () => {}, close: () => { closedC += 1; }, setAck: () => {} });
  const confirmC = buttonsOf(treeC, "spine.midConfirm")[0];
  ok(confirmC.props.disabled !== true, "勾了「我明白」才能确认");
  confirmC.props.onClick();
  ok(modelC.edits.some(([name, text]) => name === "deepCutAbove" && text === String(T.MID_ON)), "确认后才写 deepCutAbove=" + T.MID_ON);
  ok(closedC === 1, "写完把确认框收起来");
  const ackTree = T.renderPanel({ t: (key) => key, model: modelC, actions: modelC.actions() }, midOff, "session", () => {}, () => {},
    { ask: true, ack: false, open: () => {}, close: () => {}, setAck: () => {} });
  const ackBox = checkboxes(ackTree)[1];
  ok(Boolean(ackBox), "确认框里有「我明白」勾选");
  // 关掉是一键的
  const onState = { ...fakeState, settings: { ...fakeState.settings, deepCutAbove: 120000 } };
  const modelD = new SettingsFormModel({}, []);
  const treeD = T.renderPanel({ t: (key) => key, model: modelD, actions: modelD.actions() }, onState, "session", () => {}, () => {},
    { ask: false, ack: false, open: () => {}, close: () => {}, setAck: () => {} });
  const swD = checkboxes(treeD)[0];
  ok(swD.props.checked === true, "deepCutAbove=120000 时开关是开的");
  swD.props.onChange({ target: { checked: false } });
  ok(modelD.edits.some(([name, text]) => name === "deepCutAbove" && text === "0"), "关掉开关直接写 deepCutAbove=0");
  ok(modelD.saved === 1, "关掉开关立刻保存，不用再点一次保存（saved=" + modelD.saved + "）");
}

console.log("9. 全部会话视图");
const setScope = (next) => { hooks.length = 0; };
const allTree = T.renderPanel({ t: (key) => key, model, actions }, fakeState, "all", () => {}, setScope);
const allText = texts(allTree);
ok(allText.includes("spine.scopeAllHint"), "全部会话给出汇总时间提示");
ok(allText.includes("260k"), "小刀 260k 出现在全部会话统计里");
ok(allText.includes("400k"), "大刀 400k 出现在全部会话统计里");
let allRows = 0; let officialRow = false;
walk(allTree, (entry) => {
  const n = entry.node;
  if (!n) return;
  if (n.props?.className === "sp-trow" || (typeof n.props?.className === "string" && n.props.className.startsWith("sp-trow"))) allRows += 1;
  if (n.props?.key === "official") officialRow = true;
});
ok(allRows === 3, "全部会话只列小刀/中刀/大刀三行（" + allRows + "）");
ok(!officialRow, "全部会话不列官方：决策日志里没有原生存档");
ok(allText.includes("spine.sessions") && allText.includes("7"), "显示会话数 7");
ok(allText.includes("spine.attempts"), "显示尝试/跳过统计");
const sessionTree = T.renderPanel({ t: (key) => key, model, actions }, fakeState, "session", () => {}, setScope);
ok(!texts(sessionTree).includes("spine.sessionsHint"), "本会话视图不显示跨会话 KPI");
ok(texts(sessionTree).includes("80.0k"), "本会话视图显示中刀 80.0k");

console.log("9b. 切点卡：预设档 + 参考范围");
{
  let cutCard = null;
  walk(tree, (entry) => {
    const n = entry.node;
    // 旋钮现在收在切点卡内部的 details 里（标题行还在外层卡片上）。
    if (n && n.type === "details" && String(n.props?.className || "").includes("sp-knobs")) cutCard = n;
  });
  ok(Boolean(cutCard), "没有 open 属性的 details：默认收起");
  ok(Boolean(cutCard) && String(cutCard.props.className).includes("sp-knobs"), "旋钮收在切点卡的 details 里（" + (cutCard && cutCard.props.className) + "）");
  ok(cutCard && !("open" in cutCard.props), "切点卡默认不展开");
  const inside = (root, label) => {
    const found = [];
    walk(root, (entry) => {
      const n = entry.node;
      if (!n || n.type !== "button") return;
      const text = [];
      walk(n, (x) => { if (x.kind === "text") text.push(x.value); });
      if (text.join("") === label) found.push(n);
    });
    return found;
  };
  const presetLabels = cutCard ? ["spine.presetRecommended", "spine.presetSmallFirst", "spine.presetBigFirst", "spine.presetCustom"] : [];
  ok(presetLabels.filter((label) => inside(cutCard, label).length === 1).length === 4, "四个档位按钮各一个（推荐/小刀优先/大刀优先/自定义）");
  ok(inside(cutCard, "spine.presetDefault").length === 0, "出厂档按钮删掉了（它只会把人一键关光）");
  const stateWithDefaults = { ...fakeState, defaults: { chunkMax: 32000, chunkMin: 1000, burstCuts: 3, paybackTurns: 0, spanBandRatio: 0, minNetGain: 3000, deepCutAbove: 0, mergeMaxSpan: 4, mergeBreakEven: 2, mergeCooldownMs: 300000, officialAbove: 0, officialCooldownMs: 1200000, bigGate: 650000, keepRounds: 3, keepRoundTokens: 32000 } };
  // 推荐档：日常能跑的一套；11 项，不碰中刀
  const modelRec = new SettingsFormModel({}, []);
  hooks.length = 0;
  const treeRec = T.renderPanel({ t: (key) => key, model: modelRec, actions: modelRec.actions() }, stateWithDefaults, "session", () => {}, () => {});
  inside(treeRec, "spine.presetRecommended")[0]?.props?.onClick?.();
  const recNames = modelRec.edits.map(([name]) => name);
  ok(modelRec.edits.length === 11, "推荐档填 11 项（" + modelRec.edits.length + "）");
  ok(modelRec.edits.some(([name, text]) => name === "officialAbove" && text === "450000"), "推荐档 45 万请官方收");
  ok(modelRec.edits.some(([name, text]) => name === "paybackTurns" && text === "8"), "推荐档回本 8 轮");
  ok(modelRec.edits.some(([name, text]) => name === "spanBandRatio" && text === "0.06"), "推荐档刀长按 6%");
  ok(!recNames.some((name) => name === "deepCutAbove" || name.startsWith("merge")), "推荐档不碰中刀");
  // 小刀优先：只动刀法策略，中刀的旋钮一个都不碰
  const model4 = new SettingsFormModel({}, []);
  hooks.length = 0;
  const tree5 = T.renderPanel({ t: (key) => key, model: model4, actions: model4.actions() }, stateWithDefaults, "session", () => {}, () => {});
  inside(tree5, "spine.presetSmallFirst")[0]?.props?.onClick?.();
  const names = model4.edits.map(([name]) => name);
  ok(model4.edits.length === 11, "小刀优先填 11 项（" + model4.edits.length + "）");
  ok(model4.edits.some(([name, text]) => name === "officialAbove" && text === "600000"), "小刀优先把大刀推迟到 60 万");
  ok(model4.edits.some(([name, text]) => name === "spanBandRatio" && text === "0"), "小刀优先不按上下文缩刀长（用满 chunkMax）");
  ok(model4.edits.some(([name, text]) => name === "burstCuts" && text === "4"), "小刀优许多切一刀");
  ok(!names.some((name) => name === "deepCutAbove" || name.startsWith("merge")), "预设不碰中刀的旋钮（" + names.join(",") + "）");
  // 大刀优先：20 万就让官方收
  const model5 = new SettingsFormModel({}, []);
  hooks.length = 0;
  const tree6 = T.renderPanel({ t: (key) => key, model: model5, actions: model5.actions() }, stateWithDefaults, "session", () => {}, () => {});
  inside(tree6, "spine.presetBigFirst")[0]?.props?.onClick?.();
  ok(model5.edits.some(([name, text]) => name === "officialAbove" && text === "200000"), "大刀优先在 20 万就交给官方");
  ok(model5.edits.some(([name, text]) => name === "burstCuts" && text === "1"), "大刀优先一轮只切一刀");
  // 当前档要高亮：全 0（出厂值）对不上推荐/小刀/大刀，就落回自定义
  hooks.length = 0;
  const tree7 = T.renderPanel({ t: (key) => key, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() }, { ...stateWithDefaults, settings: { ...stateWithDefaults.settings, deepCutAbove: 0, paybackTurns: 0, spanBandRatio: 0, minNetGain: 3000, officialAbove: 0, burstCuts: 3 } }, "session", () => {}, () => {});
  ok(String(inside(tree7, "spine.presetCustom")[0]?.props?.className).includes("sp-btn-primary"), "对不上任何档时高亮自定义");
  // 保存过推荐值之后，打开面板高亮的就是推荐档
  hooks.length = 0;
  const treeRec2 = T.renderPanel({ t: (key) => key, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() }, { ...stateWithDefaults, settings: { ...stateWithDefaults.settings, officialAbove: 450000, paybackTurns: 8, spanBandRatio: 0.06, burstCuts: 3, minNetGain: 3000, minTokens: 20000, chunkMin: 1000, chunkMax: 32000, keepRounds: 3, keepRoundTokens: 48000, bigGate: 650000 } }, "session", () => {}, () => {});
  ok(String(inside(treeRec2, "spine.presetRecommended")[0]?.props?.className).includes("sp-btn-primary"), "推荐值保存后高亮推荐档");
}

console.log("9c. 打开就回到最上面");
{
  // 假 DOM：根节点套在一个滚到一半的宿主容器里
  const host = { scrollTop: 900, parentElement: null, style: { overflowY: "auto" } };
  const root = { scrollTop: 400, parentElement: host, style: { overflowY: "auto" } };
  globalThis.getComputedStyle = (el) => ({ overflowY: (el && el.style && el.style.overflowY) || "visible" });
  const ref = tree && tree.props && typeof tree.props.ref === "function" ? tree.props.ref : null;
  ok(typeof ref === "function", "根节点挂了 ref");
  if (ref) {
    ref(root);
    ok(root.scrollTop === 0, "自己的滚动容器归零");
    ok(host.scrollTop === 0, "宿主那个滚动容器也归零（聊天停在底部时不继承）");
    const plain = { scrollTop: 5, parentElement: null, style: { overflowY: "visible" } };
    ref(plain);
    ok(plain.scrollTop === 5, "不可滚动的元素不动它");
    ref(null);
    ok(true, "ref(null) 不抛错");
  }
  delete globalThis.getComputedStyle;
}

console.log("9d. 文档文件可以打开（走宿主 remote，不写死本机路径）");
{
  const BS = String.fromCharCode(92);
  const long = ["C:", "Users", "someone", ".dsh", "profiles", "desktop", "node_modules", "dsh-live-compact-x", "README.md"].join(BS);
  const tail = "…" + BS + ["node_modules", "dsh-live-compact-x", "README.md"].join(BS);
  const collect = (node, pred, out = []) => {
    if (!node || typeof node !== "object") return out;
    if (Array.isArray(node)) { for (const n of node) collect(n, pred, out); return out; }
    if (pred(node)) out.push(node);
    for (const c of node.children || []) collect(c, pred, out);
    return out;
  };
  const labelOf = (n) => (n.children || []).filter((c) => typeof c === "string").join("");

  ok(T.shortPath("C:/p/README.md") === "C:/p/README.md", "短路径原样显示，不硬拆");
  ok(T.shortPath(long) === tail, "长路径只露尾巴：" + T.shortPath(long));
  ok(long.includes("Users" + BS + "someone") && !T.shortPath(long).includes("someone"), "面板上不再暴露本机用户名");

  const copied = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: (text) => { copied.push(text); } } },
  });

  const previews = [];
  const row = T.DocRow({ t: (key) => key, label: "README", value: long, which: "readme", exists: true, preview: null, onPreview: (which) => previews.push(which) });
  const rowButtons = collect(row, (n) => n.type === "button");
  const previewBtn = rowButtons.find((b) => labelOf(b) === "spine.preview");
  const copyBtn = rowButtons.find((b) => labelOf(b) === "spine.copyPath");
  ok(rowButtons.length === 2 && Boolean(previewBtn) && Boolean(copyBtn), "文件行给预览和复制路径两个按钮（" + rowButtons.length + "）");
  ok(previewBtn?.props?.disabled !== true, "文件在的时候预览可用");
  previewBtn?.props?.onClick?.();
  ok(previews.length === 1 && previews[0] === "readme", "点预览去读 README");
  copied.length = 0;
  copyBtn?.props?.onClick?.();
  ok(copied.length === 1 && copied[0] === long, "复制路径给的是完整路径");
  ok(!rowButtons.some((b) => labelOf(b) === "spine.open"), "不再放注定打不开的「打开」按钮");

  const previewRow = T.DocRow({
    t: (key) => key, label: "README", value: long, which: "readme", exists: true,
    preview: { which: "readme", text: "# Spine", truncated: true }, onPreview() {},
  });
  ok(collect(previewRow, (n) => n.props?.className === "sp-doc-body").length === 1, "预览把正文铺在行下面");
  ok(collect(previewRow, (n) => n.props?.className === "sp-doc-h1").length === 1, "一级标题按标题渲染（不是原文 pre）");
  // 预览容器必须横跨整行，否则会被塞进 76px 的标签列，文字挤成竖条
  ok(T.SPINE_CSS.includes(".sp-doc-body{grid-column:1/-1;"), "预览容器横跨整行（grid-column:1/-1）");
  ok(T.SPINE_CSS.includes("grid-template-columns:76px minmax(0,1fr) auto"), "路径列可压缩，长路径不吃掉按钮");
  const richRow = T.DocRow({
    t: (key) => key, label: "CHANGELOG", value: long, which: "changelog", exists: true,
    preview: { which: "changelog", text: "# 1.0.0\n\n- **第一条** 说明\n- 第二条\n\n正文段落", truncated: false }, onPreview() {},
  });
  ok(collect(richRow, (n) => n.props?.className === "sp-doc-ul").length === 1, "要点攒成一个列表");
  ok(collect(richRow, (n) => n.props?.className === "sp-doc-ul")[0].children.length === 2, "两条要点都在");
  ok(collect(richRow, (n) => n.props?.className === "sp-doc-p").length === 1, "普通段落单独成段");
  const boldText = labelOf(collect(richRow, (n) => n.props?.className === "sp-doc-ul")[0]);
  ok(!boldText.includes("**"), "** 标记在预览里被去掉：" + boldText.slice(0, 40));
  ok(collect(previewRow, (n) => labelOf(n) === "spine.previewTruncated").length === 1, "截断时说明只显示前 4 万字");

  const loadingRow = T.DocRow({ t: (key) => key, label: "README", value: long, which: "readme", exists: true, loading: true, onPreview() {} });
  const loadingBtn = collect(loadingRow, (n) => n.type === "button").find((b) => labelOf(b) === "spine.previewLoading");
  ok(Boolean(loadingBtn) && loadingBtn.props.disabled === true, "读取中按钮禁用并换文案");

  const revealCalls = [];
  T.setBridgeCtx({ get: () => ({ session: { openWorkspacePath: (request) => { revealCalls.push(request); return Promise.resolve({ ok: true }); } } }) });
  await T.openHostPath(long, "reveal");
  ok(revealCalls.length === 1 && revealCalls[0].action === "reveal", "reveal 走 action=reveal");
  T.setBridgeCtx(null);
  const bare = await T.openHostPath(long, "open");
  ok(bare.ok === false && bare.reason === "no-remote", "没有 remote 的宿主如实报打不开：" + bare.reason);

  const missRow = T.DocRow({ t: (key) => key, label: "CHANGELOG", value: long, which: "changelog", exists: false });
  const missPreview = collect(missRow, (n) => n.type === "button").find((b) => labelOf(b) === "spine.preview");
  ok(Boolean(missPreview) && missPreview.props.disabled === true, "文件不在时预览按钮禁用");
  ok(collect(missRow, (n) => labelOf(n) === "spine.missing").length === 1, "文件不在时如实标缺，不假装能看");

  const urlRow = T.DocRow({ t: (key) => key, label: "Repo", value: "https://example.test/r", href: "https://example.test/r" });
  const urlButtons = collect(urlRow, (n) => n.type === "button");
  ok(urlButtons.length === 1 && labelOf(urlButtons[0]) === "spine.copy", "地址行只给复制，链接本身可点");
  ok(collect(urlRow, (n) => n.props?.className === "sp-path sp-doclink").length === 1, "地址行是外链");
}
console.log("9e. 构成条按刀切段，官方英文不进面板");
{
  const slices = T.cutBars(cuts);
  ok(slices.length === 5, "token 大于 0 的每一刀都有自己一段（" + slices.length + "）");
  ok(slices.map((s) => s.kind).join(",") === "small,merge,big,official,plugin", "同一种刀聚在一起：" + slices.map((s) => s.kind).join(","));
  ok(slices.filter((s) => s.first).map((s) => s.kind).join(",") === "merge,big,official,plugin", "每种刀的第一段才留组间距");
  ok(T.cutBars([]).length === 0 && T.cutBars([{ tokens: 0 }]).length === 0, "没有量就不画");
  ok(T.cutBars([{ tokens: 5, kind: "merge" }, { tokens: 9, kind: "small" }]).map((s) => s.kind).join(",") === "small,merge", "顺序按小刀/中刀/大刀排，不按时间乱跳");

  let cutBar = null;
  walk(tree, (entry) => { const n = entry.node; if (n && n.props?.className === "sp-bar sp-bar-cut") cutBar = n; });
  ok(Boolean(cutBar), "本会话用按刀切段的构成条");
  ok(cutBar && cutBar.children.length === 5, "本会话构成条画了 5 段（" + (cutBar && cutBar.children.length) + "）");
  ok(cutBar && String(cutBar.children[0].props.style.flexGrow) === "4000", "段宽按这一刀的 token 撑开");
  ok(cutBar && cutBar.children[0].props.title.includes("4.0k"), "悬停给这一刀的数量：" + (cutBar && cutBar.children[0].props.title));
  ok(cutBar && String(cutBar.children[1].props.className).includes("sp-seg-first"), "换刀处留组间距，看得出切了几刀");
  ok(cutBar && !String(cutBar.children[0].props.className).includes("sp-seg-first"), "第一段不留多余间距");
  ok(T.SPINE_CSS.includes(".sp-bar-cut .sp-seg{flex-shrink:1;box-shadow:inset -1px 0 0"), "刀与刀之间有分割线");

  let kindBar = null;
  walk(allTree, (entry) => { const n = entry.node; if (n && n.props?.className === "sp-bar") kindBar = n; });
  ok(Boolean(kindBar) && kindBar.children.length === 3, "全部会话没有逐刀记录，仍按刀法分段（" + (kindBar && kindBar.children.length) + "）");

  const englishCut = { ...cuts[5], preview: "This is an automatically generated checkpoint condensing an earlier span." };
  const englishText = texts(T.CutRow({ cut: englishCut, t: (key) => key, dir: "", index: 1 }));
  ok(englishText.includes("spine.previewEnglish") && !englishText.includes("automatically generated"), "官方英文摘要换成一句中文说明");
  const chineseCut = { ...cuts[0], preview: "Kept lines 照原句抄出。" };
  const chineseText = texts(T.CutRow({ cut: chineseCut, t: (key) => key, dir: "", index: 2 }));
  ok(chineseText.includes("照原句抄出") && !chineseText.includes("spine.previewEnglish"), "中文预览照常显示");
  const blankText = texts(T.CutRow({ cut: { ...cuts[0], preview: "" }, t: (key) => key, dir: "", index: 3 }));
  ok(!blankText.includes("spine.previewEnglish"), "没有正文的小刀不硬塞英文说明");
}
console.log("9f. 旋钮参考范围：每个刀把都写清楚范围 / 常用");
{
  const groups = T.KNOB_GROUPS.flatMap((g) => g.keys);
  ok(groups.every((name) => T.KNOB_META[name]), "15 个旋钮都有参考范围（" + groups.length + "）");
  ok(T.fmtKnobValue("chunkMax", 32000) === "32.0k", "token 按 k 显示：" + T.fmtKnobValue("chunkMax", 32000));
  ok(T.fmtKnobValue("officialCooldownMs", 1200000) === "20min", "毫秒按分钟显示：" + T.fmtKnobValue("officialCooldownMs", 1200000));
  ok(T.fmtKnobValue("officialCooldownMs", 3600000) === "1h", "整小时不带小数");
  ok(T.fmtKnobValue("spanBandRatio", 0.06) === "6.0%" && T.fmtKnobValue("spanBandRatio", 0) === "0", "比例按百分比显示：" + T.fmtKnobValue("spanBandRatio", 0.06));
  const range = T.knobRange((key) => key, "chunkMax");
  ok(range.includes("spine.rangeLabel") && range.includes("128k") && range.includes("spine.usualLabel") && range.includes("16.0k"), "范围文案带上下限与常用区间：" + range);
  ok(T.knobRange((key) => key, "officialAbove").includes("200k") && !T.knobRange((key) => key, "officialAbove").includes("0–200k"), "大刀启用线不再从 0 起：" + T.knobRange((key) => key, "officialAbove"));
  ok(T.knobRange((key) => key, "pointerTokens").includes("spine.zeroPointer"), "pointerTokens 的 0 另有含义（这个旋钮没上面板）");
  ok(T.knobRange((key) => key, "nope") === "", "没有元数据的旋钮不硬编");
  let ranges = 0;
  walk(tree, (entry) => { const n = entry.node; if (n && n.props?.className === "sp-field-range") ranges += 1; });
  ok(ranges === 15, "面板上 15 个旋钮都印了参考范围（" + ranges + "）");
  const sliders = [];
  walk(tree, (entry) => { const n = entry.node; if (n && n.type === "input" && n.props?.type === "range") sliders.push(n); });
  ok(sliders.length === 15, "15 个旋钮都画成滑块（" + sliders.length + "）");
  const ratio = sliders.find((n) => n.props.max === "0.5");
  ok(ratio && ratio.props.step === "0.01", "比例旋钮按 0.01 步进");
  // 上下线要在刀与刀之间咬住：大刀线最高 65 万；中刀线必须比大刀线低 1 万，
  // 否则上下文过线时大刀先出手、中刀永远轮不到（开了等于没开）。
  const bigSlider = sliders.find((n) => n.props["data-knob"] === "officialAbove");
  const midSlider = sliders.find((n) => n.props["data-knob"] === "deepCutAbove");
  ok(bigSlider && bigSlider.props.max === "650000", "大刀启用线最高 65 万");
  ok(midSlider && Number(midSlider.props.max) === 220000 - 10000, "中刀启用线被大刀线压住（低 1 万）：" + (midSlider && midSlider.props.max));
  const openBigState = { ...fakeState, settings: { ...fakeState.settings, officialAbove: 0 } };
  const treeOpenBig = T.renderPanel({ t: (key) => key, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() }, openBigState, "session", () => {}, () => {});
  const openSliders = [];
  walk(treeOpenBig, (entry) => { const n = entry.node; if (n && n.type === "input" && n.props?.type === "range") openSliders.push(n); });
  const openMid = openSliders.find((n) => n.props["data-knob"] === "deepCutAbove");
  ok(openMid && openMid.props.max === "650000", "大刀没设线时中刀回到 65 万上限");
  // 存反了要直说：中刀线 ≥ 大刀线时出警告，不再各显示各的
  const clashState = { ...fakeState, settings: { ...fakeState.settings, deepCutAbove: 300000, officialAbove: 220000 } };
  const treeClash = T.renderPanel({ t: (key) => key, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() }, clashState, "session", () => {}, () => {});
  const clash = [];
  walk(treeClash, (entry) => { const n = entry.node; if (n && n.props && n.props["data-knife-clash"] === "1") clash.push(n); });
  ok(clash.length >= 1, "中刀线压过大刀线时给警告");
  ok(texts(treeClash).includes("spine.lineClashHint"), "警告文案说明后果（中刀永远轮不到）");
  ok(sliders.filter((n) => n.props.max === "1000000").length === 1, "只有绝对停切线还允许到 100 万");
  const cool = sliders.filter((n) => n.props.min === "60000");
  ok(cool.length === 2, "两处冷却时间最低 1 分钟，拖不到 0（" + cool.length + "）");
}

console.log("9g. 滑块跟手、开关看草稿");
{
  const slidersOf = (tree) => {
    const out = [];
    walk(tree, (entry) => { const n = entry.node; if (n && n.type === "input" && n.props?.type === "range") out.push(n); });
    return out;
  };
  const model = new SettingsFormModel({}, []);
  const tree2 = T.renderPanel({ t: (key) => key, model, actions: model.actions() }, fakeState, "session", () => {}, () => {});
  const maxSlider = slidersOf(tree2).find((n) => n.props.max === "128000");
  ok(Boolean(maxSlider), "一刀上限是滑块");
  maxSlider.props.onChange({ target: { value: "48000" } });
  ok(model.edits.some(([name, text]) => name === "chunkMax" && text === "48000"), "拖动滑块把值写进草稿（48000）");
  maxSlider.props.onChange({ target: { value: "not-a-number" } });
  ok(model.edits.filter(([name]) => name === "chunkMax").length === 1, "非数字的拖动值不写进配置");

  // 开着中刀、但草稿里已经改成 0：开关必须显示为关（否则永远关不掉）
  const draftOff = new SettingsFormModel({}, []);
  draftOff.overrides = { deepCutAbove: "0" };
  const onState = { ...fakeState, settings: { ...fakeState.settings, deepCutAbove: 120000 } };
  const treeOff = T.renderPanel({ t: (key) => key, model: draftOff, actions: draftOff.actions() }, onState, "session", () => {}, () => {});
  const switches = [];
  walk(treeOff, (entry) => { const n = entry.node; if (n && n.type === "input" && n.props?.type === "checkbox" && !n.props["data-knob"]) switches.push(n); });
  ok(switches[0] && switches[0].props.checked === false, "草稿关掉中刀后，开关立刻显示为关");
  switches[0].props.onChange({ target: { checked: true } });
  ok(draftOff.edits.length === 0, "从关到开仍然先弹确认，不直接写");

  // shell() 还没服务（返回 {}）时，控件不能整片变灰
  const blind = { bind: () => {}, shell: () => ({}), field: () => ({ value: "", overridden: false }), actions: () => ({ edit() {}, resetField() {}, save() {}, discard() {} }), dispose() {} };
  const treeBlind = T.renderPanel({ t: (key) => key, model: blind, actions: blind.actions() }, fakeState, "session", () => {}, () => {});
  const blindSliders = slidersOf(treeBlind);
  ok(blindSliders.length === 15 && blindSliders.every((n) => n.props.disabled !== true), "配置模型还没服务时滑块也能拖");
  const blindBoxes = [];
  walk(treeBlind, (entry) => { const n = entry.node; if (n && n.type === "input" && n.props?.type === "checkbox" && !n.props["data-knob"]) blindBoxes.push(n); });
  ok(blindBoxes[0] && blindBoxes[0].props.disabled !== true, "中刀开关也不变灰");
}

console.log("9g. 调试信息不再糊原始 JSON");
{
  let dbgCard = null;
  walk(tree, (entry) => {
    const n = entry.node;
    if (!n || n.type !== "details" || n.props?.className !== "sp-details sp-card") return;
    const head = (n.children || [])[0];
    const label = [];
    if (head) walk(head, (x) => { if (x.kind === "text") label.push(x.value); });
    if (label[0] === "spine.debug") dbgCard = n;
  });
  ok(Boolean(dbgCard), "找得到调试信息卡");
  const dbgText = texts(dbgCard);
  ok(!dbgText.includes('"kinds"') && !dbgText.includes('"savedBy"') && !dbgText.includes('"chunkMax"'), "不再把原始 JSON 糊在面板上");
  const collect = (node, pred, out = []) => {
    if (!node || typeof node !== "object") return out;
    if (Array.isArray(node)) { for (const item of node) collect(item, pred, out); return out; }
    if (pred(node)) out.push(node);
    for (const child of node.children || []) collect(child, pred, out);
    return out;
  };
  const dbgRows = collect(dbgCard, (n) => n.props?.className === "sp-dbg-row");
  ok(dbgRows.length === Object.keys(fakeState.settings).length, "生效设置按旋钮逐行列出（" + dbgRows.length + "）");
  ok(dbgText.includes("一刀上限") && dbgText.includes("32.0k"), "旋钮名用中文标签、值带单位");
  ok(dbgText.includes("6.0%"), "比例按百分比显示");
  ok(!dbgText.includes("Users" + String.fromCharCode(92) + "HP"), "调试信息不把本机用户名摊出来（路径只露尾巴）：" + dbgText.slice(0, 60));
  ok(dbgText.includes("spine.knifeSmall 2") && dbgText.includes("spine.knifePlugin 1"), "计数按刀法摊开：" + dbgText.slice(0, 80));
  const copies = collect(dbgCard, (n) => n.type === "button").filter((n) => {
    const label = [];
    walk(n, (x) => { if (x.kind === "text") label.push(x.value); });
    const text = label.join("");
    return text === "spine.copyCounts" || text === "spine.copySettings";
  });
  ok(copies.length === 2 && copies[0] !== copies[1], "计数与设置各给一个（名字分得清）复制按钮（" + copies.length + "）");
  const copied = [];
  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    value: { clipboard: { writeText: (text) => { copied.push(text); } } },
  });
  copies[1]?.props?.onClick?.();
  ok(copied.length === 1 && copied[0].includes('"chunkMax":32000'), "复制出来的是完整 JSON：" + String(copied[0]).slice(0, 40));
}

console.log("9g. 时间线只铺最近 10 刀，其余展开看");
{
  const many = Array.from({ length: 30 }, (_, i) => ({ ...cuts[0], id: "m" + i, kind: "small", tokens: 1000 + i, time: 1000 + i }));
  const stateMany = { ...fakeState, cuts: many, kinds: { small: 30, merge: 0, plugin: 0, big: 0, official: 0 } };
  const rowCount = (tree) => {
    let n = 0;
    walk(tree, (entry) => { if (entry.node && entry.node.props && entry.node.props.className === "sp-row") n += 1; });
    return n;
  };
  const labelOf = (node) => { const out = []; walk(node, (x) => { if (x.kind === "text") out.push(x.value); }); return out.join(""); };
  const buttonByText = (tree, prefix) => {
    let hit = null;
    walk(tree, (entry) => {
      const n = entry.node;
      if (!n || n.type !== "button") return;
      if (labelOf(n).startsWith(prefix)) hit = n;
    });
    return hit;
  };
  const treeMany = T.renderPanel({ t: (key) => key, model, actions }, stateMany, "session", () => {}, () => {});
  ok(rowCount(treeMany) === 10, "默认只画最近 10 刀（" + rowCount(treeMany) + "）");
  ok(texts(treeMany).includes("spine.expandRest") && texts(treeMany).includes("20"), "还有 20 刀时给展开入口：" + texts(treeMany).slice(0, 0));
  ok(String(T.SPINE_CSS).includes(".sp-row") && String(T.SPINE_CSS).includes("padding:1px 6px"), "时间线行排得更紧（padding 1px）");
  let toggled = 0;
  const treeAll = T.renderPanel({ t: (key) => key, model, actions }, stateMany, "session", () => {}, () => {}, undefined, { timelineAll: true, toggleTimeline: () => { toggled += 1; } });
  ok(rowCount(treeAll) === 30, "展开后画满 30 刀（" + rowCount(treeAll) + "）");
  ok(texts(treeAll).includes("spine.onlyRecent"), "展开后能收回最近 10 刀");
  buttonByText(treeAll, "spine.onlyRecent")?.props?.onClick?.();
  ok(toggled === 1, "收回按钮真的切回去了");
  ok(String(T.SPINE_CSS).includes(".sp-scroll-tall{max-height:420px"), "展开的列表限高可滚，不把面板撑长");
  const treeFew = T.renderPanel({ t: (key) => key, model, actions }, fakeState, "session", () => {}, () => {}, undefined, {});
  ok(!texts(treeFew).includes("spine.expandRest"), "不足 10 刀时不显示展开按钮");
}

console.log("9g1. 顶栏直接显示版本号（不用展开文档卡）");
{
  const versionNode = (tree) => {
    let hit = null;
    walk(tree, ({ kind, node }) => { if (kind === "node" && node.props?.className === "sp-version") hit = node; });
    return hit;
  };
  const labelOf = (node) => { const out = []; walk(node, (x) => { if (x.kind === "text") out.push(x.value); }); return out.join(""); };

  // 顶栏是面板最外层那行；版本必须挂在它里面，而不是藏进文档卡。
  const topbarOf = (tree) => {
    let hit = null;
    walk(tree, ({ kind, node }) => { if (kind === "node" && node.props?.className === "sp-topbar") hit = node; });
    return hit;
  };
  const badge = versionNode(tree);
  ok(Boolean(badge), "顶栏上有版本徽标");
  ok(labelOf(badge) === "v1.3.14-x.0", "显示成 v+版本号：" + labelOf(badge));
  ok(badge.props["data-version"] === "1.3.14-x.0", "data-version 带原始版本号");
  ok(String(badge.props.title).includes("spine.version") && String(badge.props.title).includes("1.3.14-x.0"), "悬停给「版本 + 号」");
  // 它确实在顶栏里：顶栏节点里能 walk 到它
  const inTopbar = (() => {
    let found = false;
    walk(topbarOf(tree), ({ kind, node }) => { if (kind === "node" && node.props?.className === "sp-version") found = true; });
    return found;
  })();
  ok(inTopbar, "版本徽标在顶栏内部");
  // 顶栏是一行普通 div，不是 details：不需要点开就能看见版本号。
  ok(topbarOf(tree)?.type === "div", "顶栏是常驻的一行，不是可收起的 details");
  // 文档卡默认收起：版本号不能只躺在里面（那正是这次要修的体验）。
  let docsCard = null;
  walk(tree, ({ kind, node }) => {
    if (kind !== "node" || node.type !== "details") return;
    const label = [];
    walk(node, (x) => { if (x.kind === "text") label.push(x.value); });
    if (label[0] === "spine.docs") docsCard = node;
  });
  ok(Boolean(docsCard) && !("open" in docsCard.props), "文档卡仍默认收起，版本号不靠它");

  // 全部会话视图同样有
  const allBadge = versionNode(allTree);
  ok(Boolean(allBadge) && labelOf(allBadge) === "v1.3.14-x.0", "全部会话视图也显示版本");

  // 版本串自带 v 时不重复写
  const vTree = T.renderPanel({ t: (k) => k, model, actions }, { ...fakeState, docs: { ...fakeState.docs, version: "v2.0.1" } }, "session", () => {}, () => {});
  ok(labelOf(versionNode(vTree)) === "v2.0.1", "版本串本身带 v 时不叠成 vv：" + labelOf(versionNode(vTree)));

  // 没有版本时优雅降级：不画空徽标，也不留一个孤零零的 v
  for (const [label, docs] of [
    ["docs 为空对象", {}],
    ["version 是空串", { ...fakeState.docs, version: "" }],
    ["version 只有空白", { ...fakeState.docs, version: "   " }],
    ["version 是 undefined", { ...fakeState.docs, version: undefined }],
    ["整个 docs 缺失", undefined],
  ]) {
    const t2 = T.renderPanel({ t: (k) => k, model, actions }, { ...fakeState, docs }, "session", () => {}, () => {});
    ok(versionNode(t2) === null, label + "：不渲染版本徽标（" + label + "）");
    ok(!texts(t2).includes("顶栏 v"), label + "：没有空的 v 文案");
  }
  // state 完全没有（渲染兜底）时也不能因为版本崩掉
  const bare = T.SpinePanel({ t: (k) => k, useProjection: () => undefined });
  ok(versionNode(bare) === null, "没有投影时不画版本徽标，也不因为版本崩掉");
  ok(texts(bare).includes("spine.unavailable"), "没有投影时仍是原来的提示（版本不影响兜底）");

  // 样式：和顶栏其它小控件同一套边框/底色
  ok(T.SPINE_CSS.includes(".sp-version{"), "版本徽标有样式");
  ok(String(T.SPINE_CSS).includes(".sp-version{flex:none;font-size:11px"), "版本徽标字号与顶栏一致（11px）");
  ok(String(T.SPINE_CSS).includes("border-radius:999px"), "版本徽标是胶囊形，与 scope 按钮区分开");
}

console.log("9g2. 大刀归纳器：官方模型 / 本地脚本两选一");
{
  const choiceButtons = (tree) => {
    const out = [];
    walk(tree, ({ kind, node }) => {
      if (kind !== "node" || !node.props) return;
      if (node.props["data-choice"] === "officialScript") out.push(node);
    });
    return out;
  };
  const labelOf = (node) => { const out = []; walk(node, (x) => { if (x.kind === "text") out.push(x.value); }); return out.join(""); };

  const modelS = new SettingsFormModel({}, []);
  const treeS = T.renderPanel({ t: (k) => k, model: modelS, actions: modelS.actions() }, fakeState, "session", () => {}, () => {});
  const btns = choiceButtons(treeS);
  ok(btns.length === 2, "大刀组给两个按钮（官方模型 / 本地脚本）：" + btns.length);
  ok(labelOf(btns[0]) === "spine.scriptModel" && labelOf(btns[1]) === "spine.scriptLocal", "按钮文案是官方模型 / 本地脚本");
  ok(btns.every((b) => b.type === "button"), "是按钮，不是滑块");
  ok(!btns.some((b) => b.props.type === "range"), "不是滑块：官方模型/脚本不是连续量");

  // 默认（officialScript 缺省 / 0）高亮官方模型
  ok(String(btns[0].props.className).includes("sp-choice-on"), "默认高亮官方模型：" + btns[0].props.className);
  ok(!String(btns[1].props.className).includes("sp-choice-on"), "默认不把本地脚本点亮");
  ok(String(btns[0].props.title).includes("LLM 成本") || btns[0].props.title.includes("spine.scriptModelHint"), "官方模型按钮带 LLM 成本说明");
  ok(String(btns[1].props.title).includes("spine.scriptLocalHint"), "本地脚本按钮带零模型调用说明");
  ok(texts(treeS).includes("spine.scriptModelHint"), "选中项下面铺开说明");
  ok(texts(treeS).includes("spine.scriptActive"), "写明当前生效的是哪个");

  // 点「本地脚本」：只写草稿（不是立刻保存），并且高亮跟着走
  btns[1].props.onClick();
  ok(modelS.edits.some(([name, text]) => name === "officialScript" && text === "1"), "点本地脚本写 officialScript=1 进草稿");
  ok(modelS.saved === 0, "点按钮不自动保存（仍要按保存）");
  const afterEdit = choiceButtons(T.renderPanel({ t: (k) => k, model: modelS, actions: modelS.actions() }, fakeState, "session", () => {}, () => {}));
  const draftModel = new SettingsFormModel({}, []);
  draftModel.overrides = { officialScript: "1" };
  const treeDraft = T.renderPanel({ t: (k) => k, model: draftModel, actions: draftModel.actions() }, fakeState, "session", () => {}, () => {});
  const draftBtns = choiceButtons(treeDraft);
  ok(String(draftBtns[1].props.className).includes("sp-choice-on"), "草稿里选了脚本就高亮脚本");
  ok(!String(draftBtns[0].props.className).includes("sp-choice-on"), "草稿里官方模型不再高亮");
  ok(texts(treeDraft).includes("spine.scriptDraft"), "草稿态明确写「改了要保存才生效」");
  ok(afterEdit.length === 2, "重画后按钮还在两个");

  // settings 里已经是 1：高亮脚本
  const scriptState = { ...fakeState, settings: { ...fakeState.settings, officialScript: 1 } };
  const treeScript = T.renderPanel({ t: (k) => k, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() }, scriptState, "session", () => {}, () => {});
  const scriptBtns = choiceButtons(treeScript);
  ok(String(scriptBtns[1].props.className).includes("sp-choice-on"), "officialScript=1 时高亮本地脚本");
  ok(texts(treeScript).includes("spine.scriptLocalHint"), "脚本态下的说明是零模型调用");

  // 两行提示要真能读：原来都用 sp-field-hint（10.5px + dimmed），深色底上几乎融进背景。
  {
    const nodesOfClass = (root, cls) => {
      const out = [];
      walk(root, ({ kind, node }) => {
        if (kind !== "node" || !node.props) return;
        const list = String(node.props.className || "").split(/\s+/).filter(Boolean);
        if (list.includes(cls)) out.push(node);
      });
      return out;
    };
    const hints = nodesOfClass(treeScript, "sp-choice-hint");
    const nows = nodesOfClass(treeScript, "sp-choice-now");
    // 现在有两组两选一：大刀归纳器 + 本地脚本版本，各有一行说明和一行「当前」。
    ok(hints.length === 2, "每组两选一都有一行 sp-choice-hint（" + hints.length + "）");
    ok(nows.length === 2, "每组两选一都有一行 sp-choice-now（" + nows.length + "）");
    // 只看这颗「大刀归纳器」的容器：面板别处（旋钮说明、组提示）仍该用 sp-field-hint。
    const choiceBox = nodesOfClass(treeScript, "sp-choice")[0];
    ok(Boolean(choiceBox), "找得到大刀归纳器容器");
    ok(!nodesOfClass(choiceBox, "sp-field-hint").length, "容器内不再用 10.5px 的 sp-field-hint（" + nodesOfClass(choiceBox, "sp-field-hint").length + "）");
    ok(!nodesOfClass(choiceBox, "sp-dim").length, "容器内不再用 sp-dim（" + nodesOfClass(choiceBox, "sp-dim").length + "）");
    for (const node of [...hints, ...nows]) {
      const cls = String(node.props.className || "").split(/\s+/);
      ok(!cls.includes("sp-field-hint") && !cls.includes("sp-dim"), "提示节点不带 sp-field-hint / sp-dim：" + node.props.className);
    }
    ok(hints[0].type === "div" || typeof hints[0].type === "function", "说明是块级节点（自带背景）");
    // 「当前」行把选中的选项名包进 b：强调靠元素，不靠整行变色。
    const bolds = [];
    walk(nows[0], (entry) => { if (entry.kind === "node" && entry.node.type === "b") bolds.push(entry.node); });
    ok(bolds.length === 1, "「当前」行有一个 b 包住选中项（" + bolds.length + "）");
    ok(bolds[0] && labelOf(bolds[0]) === "spine.scriptLocal", "b 里是当前选中的选项名：" + labelOf(bolds[0]));
    ok(texts(nows[0]).includes("spine.scriptActive"), "「当前」行仍然带前缀文案");

    // 默认档（officialScript=0）也要走同一套样式
    const defaultHints = nodesOfClass(treeS, "sp-choice-hint");
    const defaultNow = nodesOfClass(treeS, "sp-choice-now");
    ok(defaultHints.length === 2 && defaultNow.length === 2, "默认档下两组都是 choice 专用的两行");
    const defaultBold = [];
    walk(defaultNow[0], (entry) => { if (entry.kind === "node" && entry.node.type === "b") defaultBold.push(entry.node); });
    ok(defaultBold.length === 1 && labelOf(defaultBold[0]) === "spine.scriptModel", "默认档的 b 是官方模型：" + labelOf(defaultBold[0]));

    // CSS 侧：字号必须抬到 11.5px，颜色不能是 dimmed
    const css = String(T.SPINE_CSS);
    const rule = (selector) => {
      const at = css.indexOf(selector + "{");
      return at < 0 ? "" : css.slice(at, css.indexOf("}", at) + 1);
    };
    const hintRule = rule(".sp-choice-hint");
    const nowRule = rule(".sp-choice-now");
    const boldRule = rule(".sp-choice-now b");
    ok(hintRule.includes("font-size:11.5px"), "sp-choice-hint 字号 11.5px：" + hintRule.slice(0, 60));
    ok(hintRule.includes("line-height:1.6"), "sp-choice-hint 行高 1.6");
    ok(hintRule.includes("var(--dsw-alias-label-secondary)") && !hintRule.includes("dimmed"), "sp-choice-hint 用 secondary，不是 dimmed");
    ok(hintRule.includes("padding:6px 8px") && hintRule.includes("background:var(--dsw-alias-bg-layer-2)"), "sp-choice-hint 有自己的底色块");
    ok(hintRule.includes("border-radius:6px") && hintRule.includes("margin-top:4px"), "sp-choice-hint 圆角与上间距");
    ok(nowRule.includes("font-size:11.5px") && nowRule.includes("margin-top:4px"), "sp-choice-now 字号与上间距");
    ok(nowRule.includes("var(--dsw-alias-label-secondary)") && !nowRule.includes("dimmed"), "sp-choice-now 用 secondary，不是 dimmed");
    ok(boldRule.includes("var(--dsw-alias-label-primary)") && boldRule.includes("font-weight:600"), "当前值用 label-primary + 600 强调：" + boldRule.slice(0, 60));

    // 本地脚本版本：默认高亮「新版（探索）」，切到稳定版时高亮换边
    const engineBtns = nodesOfClass(treeScript, "sp-choice-btn").filter((node) => node.props["data-choice"] === "scriptEngine");
    ok(engineBtns.length === 2, "本地脚本版本是两选一（" + engineBtns.length + "）");
    ok(engineBtns[1].props["data-value"] === "1" && String(engineBtns[1].props.className).includes("sp-choice-on"), "默认选中的是新版（value=1）");
    ok(engineBtns[0].props["data-value"] === "0" && !String(engineBtns[0].props.className).includes("sp-choice-on"), "稳定版没被选中");
    const stableState = { ...fakeState, settings: { ...fakeState.settings, scriptEngine: 0 } };
    const treeStable = T.renderPanel({ t: (k) => k, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() }, stableState, "session", () => {}, () => {});
    const stableBtns = nodesOfClass(treeStable, "sp-choice-btn").filter((node) => node.props["data-choice"] === "scriptEngine");
    ok(String(stableBtns[0].props.className).includes("sp-choice-on"), "scriptEngine=0 时高亮稳定版");
    ok(texts(treeStable).includes("spine.engineStableHint"), "稳定版有自己的说明");
  }

  // 不进 11 项预设：点推荐档不能改到 officialScript
  const modelP = new SettingsFormModel({}, []);
  hooks.length = 0;
  const treeP = T.renderPanel({ t: (k) => k, model: modelP, actions: modelP.actions() }, fakeState, "session", () => {}, () => {});
  const presetBtn = (() => { let hit = null; walk(treeP, ({ kind, node }) => { if (kind === "node" && node.type === "button" && labelOf(node) === "spine.presetRecommended") hit = node; }); return hit; })();
  presetBtn?.props?.onClick?.();
  ok(modelP.edits.length === 11, "推荐档仍然是 11 项（" + modelP.edits.length + "）");
  ok(!modelP.edits.some(([name]) => name === "officialScript"), "预设不碰大刀归纳器（花钱的事让人自己选）");
  ok(!T.PRESETS.some((preset) => Object.prototype.hasOwnProperty.call(preset.values || {}, "officialScript")), "三个预设的 values 里都没有 officialScript");
}

console.log("9h. 滑块上下限：不许从 0 开始，关掉用勾");
{
  const meta = T.KNOB_META;
  ok(meta.officialAbove.min === 200000 && meta.deepCutAbove.min === 100000, "大刀/中刀启用线从 20 万 / 10 万起");
  ok(meta.paybackTurns.min === 1 && meta.spanBandRatio.min === 0.01 && meta.minNetGain.min === 500, "小刀的回本/比例/门槛各有下限");
  ok(meta.chunkMax.min === 8000 && meta.chunkMin.min === 1000, "单刀上下限抬到能用的区间");
  ok(meta.officialCooldownMs.min === 60000 && meta.mergeCooldownMs.min === 60000, "冷却最低 1 分钟");
  const rangeMins = [];
  walk(tree, (entry) => {
    const n = entry.node;
    if (n && n.type === "input" && n.props && n.props.type === "range") rangeMins.push(String(n.props.min));
  });
  ok(rangeMins.length === 15 && rangeMins.every((value) => value !== "0"), "15 个滑块没有一个是 0 起（" + rangeMins.join(",") + "）");
  let minis = 0;
  walk(tree, (entry) => {
    const n = entry.node;
    if (n && n.props && String(n.props.className || "").startsWith("sp-mini")) minis += 1;
  });
  ok(minis === 4, "回本/比例/净收益/大刀各配一个启用勾（" + minis + "）");
  const findKnob = (node, name, type) => {
    let hit = null;
    walk(node, (entry) => {
      const n = entry.node;
      if (n && n.type === "input" && n.props && n.props["data-knob"] === name && n.props.type === type) hit = n;
    });
    return hit;
  };
  const model5 = new SettingsFormModel({}, []);
  const treeH = T.renderPanel({ t: (key) => key, model: model5, actions: model5.actions() }, fakeState, "session", () => {}, () => {});
  const officialBox = findKnob(treeH, "officialAbove", "checkbox");
  ok(Boolean(officialBox), "大刀启用线有启用勾");
  officialBox.props.onChange({ target: { checked: false } });
  ok(model5.edits.some(([name, value]) => name === "officialAbove" && value === "0"), "取消勾选写 0 = 关");
  officialBox.props.onChange({ target: { checked: true } });
  ok(model5.edits.some(([name, value]) => name === "officialAbove" && value === "300000"), "勾上回到 30 万，不是 0");
  ok(!findKnob(treeH, "deepCutAbove", "checkbox"), "中刀启用线没有第二个勾（组标题那个开关说了算）");
  const offState = { ...fakeState, settings: { ...fakeState.settings, paybackTurns: 0 } };
  const treeOff = T.renderPanel({ t: (key) => key, model, actions }, offState, "session", () => {}, () => {});
  ok(texts(treeOff).includes("spine.offState"), "关着的旋钮显示「关」而不是 0");
  const pbRange = findKnob(treeOff, "paybackTurns", "range");
  ok(pbRange && pbRange.props.disabled === true, "关着的旋钮滑块置灰");
  const pbBox = findKnob(treeOff, "paybackTurns", "checkbox");
  ok(pbBox && pbBox.props.checked === false, "关着的旋钮勾是空的");
}

console.log("9i. 时间线时间列：表格用短格式，完整时间进 title");
{
  // fmtRowTime：表格专用 MM-DD HH:mm:ss（14 字符），0 仍然是破折号
  ok(T.fmtRowTime(0) === "—" && T.fmtRowTime(undefined) === "—", "表格时间没有值时也是破折号");
  const sample = new Date(2026, 10, 25, 0, 15, 33).getTime();
  ok(T.fmtRowTime(sample) === "11-25 00:15:33", "表格时间格式 MM-DD HH:mm:ss：" + T.fmtRowTime(sample));
  ok(T.fmtRowTime(sample).length === 14, "表格时间 14 字符，装得进时间列（" + T.fmtRowTime(sample).length + "）");
  ok(!T.fmtRowTime(sample).includes("2026"), "表格里不再带年份（放不下）");
  ok(T.fmtClock(sample) === "2026-11-25 00:15:33", "fmtClock 仍然是完整日期：" + T.fmtClock(sample));
  ok(T.fmtClock(sample).length === 19, "完整日期仍为 19 字符");

  // 时间线单元格：文本是短格式，title 是完整日期
  const timedCuts = [
    { id: "t1", kind: "small", tokens: 4000, start: 10, end: 20, time: sample, rawNames: [], model: "m" },
    { id: "t2", kind: "big", tokens: 60000, start: 100, end: 900, time: sample + 3600000, rawNames: [], model: "m" },
  ];
  const timeState = { ...fakeState, cuts: timedCuts };
  const timeTree = T.renderPanel({ t: (k) => k, model, actions }, timeState, "session", () => {}, () => {});
  const timeCells = [];
  walk(timeTree, ({ kind, node }) => {
    if (kind !== "node" || !node.props) return;
    const cls = String(node.props.className || "").split(" ");
    if (cls.includes("sp-cell-time") && node.type === "span") timeCells.push(node);
  });
  // 表头 + 两行
  const rowCells = timeCells.filter((node) => node.props.title);
  ok(rowCells.length === 2, "每一刀的时间单元格都挂了 title（" + rowCells.length + "）");
  ok(rowCells.every((node) => /^\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(node.children.join(""))),
    "单元格文本是 MM-DD HH:mm:ss：" + rowCells.map((n) => n.children.join("")).join(" | "));
  ok(rowCells.every((node) => /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(node.props.title)),
    "title 是完整 YYYY-MM-DD HH:mm:ss：" + rowCells.map((n) => n.props.title).join(" | "));
  // 时间线是「新的在前」，所以行序与 cuts 相反；两边的时间集合必须一致。
  const titles = rowCells.map((node) => node.props.title).sort();
  const wanted = timedCuts.map((cut) => T.fmtClock(cut.time)).sort();
  ok(titles.join("|") === wanted.join("|"), "title 与每一刀的真实时间一一对得上：" + titles.join(" | "));
  ok(rowCells.every((node) => String(node.props.className).includes("sp-cell-time")), "单元格都带 sp-cell-time");
  ok(timeCells.some((node) => !node.props.title && node.children.join("") === "spine.colTime"), "表头时间列用同一个类（宽度对齐）");

  // 面板别处仍然是完整日期，不许被这次改动带跑：全部会话的副标题与 KPI 提示都用 fmtClock。
  const allScopeTree = T.renderPanel({ t: (k) => k, model, actions }, fakeState, "all", () => {}, () => {});
  const allScopeText = texts(allScopeTree);
  ok(allScopeText.includes(T.fmtClock(fakeState.global.generatedAt)), "副标题/生成时间仍是完整日期：" + T.fmtClock(fakeState.global.generatedAt));
  ok(allScopeText.includes("spine.generated"), "KPI 的时间提示还在");
  // 副标题那一格逐字校验：短格式「11-25 …」恰好是完整串的子串，不能用 includes 反查，
  // 所以直接看 sp-topbar-sub 的节点文本，确认它挂的是 fmtClock 而不是 fmtRowTime。
  let subText = "";
  walk(allScopeTree, ({ kind, node }) => {
    if (kind !== "node" || !node.props) return;
    if (String(node.props.className || "").includes("sp-topbar-sub")) subText = (node.children || []).join("");
  });
  ok(subText.endsWith(T.fmtClock(fakeState.global.generatedAt)), "副标题挂的是完整 fmtClock：" + subText);
  // 短格式是完整串的后缀，不能用 endsWith 反查；直接看有没有 4 位年份。
  ok(/\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(subText), "副标题带完整年份，不是表格短格式：" + subText);
  ok(T.fmtRowTime(fakeState.global.generatedAt) === subText.slice(-14), "短格式确实只是完整串的后缀（14 字符）");

  // CSS：时间列 92px + nowrap
  const css = String(T.SPINE_CSS);
  const rowRule = (css.match(/\.sp-row\{[^}]*\}/) || [""])[0];
  const headRule = (css.match(/\.sp-head\{[^}]*\}/) || [""])[0];
  ok(rowRule.includes("92px"), "行的时间列 92px：" + (rowRule.match(/grid-template-columns:[^;]*/) || [""])[0]);
  ok(headRule.includes("92px"), "表头的时间列也是 92px（两行对齐）");
  ok(!rowRule.includes("54px"), "时间列不再是 54px");
  ok(headRule.includes("1fr") && rowRule.includes("1fr"), "1fr 仍留着吸收多余宽度");
  ok(css.includes(".sp-cell-time{white-space:nowrap"), "时间单元格 nowrap：" + ((css.match(/\.sp-cell-time\{[^}]*\}/) || [""])[0]));
  ok(css.includes("font-variant-numeric:tabular-nums"), "等宽数字，秒位不跳");
  ok(rowRule.includes("padding:1px 6px") && rowRule.includes("font-size:11.5px"), "行样式其它部分没被改动");
}

console.log("10. 计数不受时间线长度影响");
{
  // 时间线只留最近几刀，但累计计数是投影给的：视图要按计数算，不能拿时间线长度充数。
  const capped = { ...fakeState, cuts: cuts.slice(0, 2), kinds: { small: 40, merge: 9, plugin: 3, big: 5, official: 7 }, savedBy: { small: 100000, merge: 200000, plugin: 30000, big: 500000, official: 400000 } };
  const cappedTree = T.renderPanel({ t: (key) => key, model, actions }, capped, "session", () => {}, setScope);
  const cappedText = texts(cappedTree);
  ok(cappedText.includes("1.23M"), "累计切掉用投影计数（1.23M）：" + cappedText.slice(0, 40));
  ok(cappedText.includes("57"), "我方刀数 = 40+9+3+5");
}

console.log("11. 设置值缺失时的兜底");
{
  const noSettings = { ...fakeState, settings: undefined };
  const t2 = T.renderPanel({ t: (key) => key, model, actions }, noSettings, "session", () => {}, setScope);
  ok(texts(t2).includes("spine.cutPoint"), "没有设置值也给旋钮区");
  let inputs = 0;
  walk(t2, (entry) => { const n = entry.node; if (n && n.type === "input" && n.props?.type === "range") inputs += 1; });
  ok(inputs === 15, "15 个滑块仍然渲染（" + inputs + "）");
}

console.log("12. apply()：样式注入与页签注册");
const registrations = [];
const effects = [];
const ctx = {
  slots: {
    inject: (name, factory) => { effects.push(name); return factory(); },
    register: (options, component) => { registrations.push({ options, component }); return () => {}; },
  },
  locale: { bind: () => (key) => key, register: () => () => {} },
  configForms: { get: () => ({}), whileServed: (names, fn) => fn(new Set(names)) },
  effect: (fn) => { const dispose = fn(); effects.push("effect"); return dispose; },
};
plugin.apply(ctx);
ok(inserted.length === 1 && inserted[0].includes(".sp-root"), "样式注入一次");
ok(inserted[0].includes("--dsw-alias-bg-layer-1"), "用的是宿主主题变量，不是写死的颜色");
ok(inserted[0].includes(".sp-scope-btn") && inserted[0].includes(".sp-trow"), "新面板的样式也在里面");
const view = registrations.find((r) => r.options.name === "conversation.view");
ok(Boolean(view), "注册了 conversation.view");
ok(view.options.id === "dsh-live-compact-x#cuts" && view.options.order === 25, "id 与位置 " + view.options.id + " / " + view.options.order);
ok(typeof view.options.label === "function" && view.options.label() === "tab.spine", "标签是本地化函数");
const rendered = view.component({ useProjection: () => fakeState });
ok(texts(rendered).includes("549k"), "通过注册入口也能渲染出统计");
let rootEl = null;
walk(rendered, ({ kind, node }) => { if (kind === "node" && node.props && node.props.className === "sp-root") rootEl = node; });
ok(Boolean(rootEl) && rootEl.props["data-spine-cover"] === "" && rootEl.props["data-conversation-composer-overlay"] === "", "压缩页整页铺开：根上挂了整页标记");
ok(inserted[0].includes("[data-conversation-scroll]:has([data-spine-cover])>[data-composer-seat]"), "只在这个页签藏输入条，轨迹页共用同一属性不误伤");
ok(inserted[0].includes("padding:12px 14px 24px") && !inserted[0].includes("padding:12px 14px 104px"), "整页之后不再给输入条留 104px");
let reloadButton = null;
walk(rendered, ({ kind, node }) => {
  if (kind === "node" && node.type === "button" && String(node.props?.className || "").includes("sp-topbar-reload")) reloadButton = node;
});
let reloads = 0;
const realLocation = globalThis.location;
globalThis.location = { reload: () => { reloads += 1; } };
if (reloadButton) reloadButton.props.onClick();
globalThis.location = realLocation;
ok(Boolean(reloadButton) && reloads === 1, "顶栏有刷新按钮：桌面端没绑 Ctrl+R，点了真的 reload");
const settingsRow = registrations.find((r) => r.options.name === "plugins.row.config");
ok(Boolean(settingsRow), "设置页那条还在，没被面板挤掉");

console.log("13. 配置桥：面板直写 spine-settings.json");
{
  const realFetch = globalThis.fetch;
  const realDocument = globalThis.document;
  globalThis.document = { baseURI: "http://127.0.0.1:7124/" };
  const calls = [];
  let failNext = false;
  const switches = { file: "C:/u/.dsh/spine-switch.json", global: true, session: true, sessionDisabled: false, disabledCount: 0 };
  const value = (body) => ({
    file: "C:/u/.dsh/spine-settings.json",
    effective: { minNetGain: 3000, deepCutAbove: 0 },
    defaults: { minNetGain: 3000, deepCutAbove: 0 },
    overrides: {},
    fixed: {},
    switch: { ...switches },
    presets: {
      file: "C:/u/.dsh/spine-presets.json",
      workspaceKey: "--D-ws--",
      workspaceKnown: true,
      scopes: {
        session: body.op === "preset-save"
          ? { active: "p-1", items: [{ id: "p-1", name: body.name || "夜间省流", values: body.values || {}, createdAt: 1, updatedAt: 2 }] }
          : { active: "", items: [] },
        workspace: { active: "", items: [] },
        all: { active: "", items: [] },
      },
      layer: body.op === "preset-save" ? { scope: "session", id: "p-1", name: body.name || "夜间省流" } : null,
    },
    ...(body.op === "save" ? { overrides: body.patch, savedAt: 1234567 } : {}),
    ...(body.op === "switch" ? { switch: { ...switches, global: body.enabled, session: body.enabled }, savedAt: 7654321 } : {}),
  });
  globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : {};
    calls.push({ url: String(url), body, method: init && init.method });
    if (failNext) return { status: 500, json: async () => ({ ok: false, code: "internal", message: "写不进去" }) };
    if (body.op === "doc") return { status: 200, json: async () => ({ ok: true, value: { available: true, path: "C:/u/README.md", text: "# Spine", truncated: false } }) };
    return { status: 200, json: async () => ({ ok: true, value: value(body) }) };
  };

  const store = T.createSettingsStore();
  ok(store.getSnapshot().status === "idle", "还没连的时候是 idle");
  await store.load();
  const ready = store.getSnapshot();
  ok(ready.status === "ready" && ready.effective.minNetGain === 3000, "describe 拿到生效值");
  ok(calls[0].url.endsWith("/api/dsh-live-compact-x-settings") && calls[0].method === "POST", "走面板自己的桥，POST 到前缀本身：" + calls[0].url);
ok(calls[0].body.op === "describe", "op 放在 body 里，不靠 URL 分段");
  store.edit("minNetGain", "5000");
  ok(store.getSnapshot().draft.minNetGain === "5000", "改一格立刻进草稿");
  ok(store.dirty("minNetGain") && !store.dirty("bigGate"), "只标改过的那一格");
  await store.save();
  const saveCall = calls.find((c) => c.body.op === "save");
  ok(Boolean(saveCall) && saveCall.body.patch.minNetGain === "5000", "保存把草稿整批交给桥");
  const savedSnap = store.getSnapshot();
  ok(Object.keys(savedSnap.draft).length === 0 && savedSnap.savedAt > 0, "保存成功后草稿清空、留时间戳");

  failNext = true;
  store.edit("bigGate", "400000");
  const failed = await store.save();
  ok(failed === false && store.getSnapshot().saveError.includes("写不进去"), "保存失败把原因留下来：" + store.getSnapshot().saveError);
  ok(store.dirty("bigGate"), "失败时草稿不清空，还能重试");

  failNext = false;
  await store.saveNow({ deepCutAbove: 120000 });
  const midCall = calls.filter((c) => c.body.op === "save").pop();
  ok(Boolean(midCall) && midCall.body.patch.deepCutAbove === 120000, "中刀开关走单键直写");

  await store.openDoc("readme");
  ok(store.getSnapshot().doc && store.getSnapshot().doc.text === "# Spine", "预览把正文读回来");

  // 总开关：describe 带 sid，切换只发一条 op=switch
  ok(calls[0].body.sid === "", "第一次 describe 也带 sid（空串）");
  await store.load("sess-a");
  const sidCall = calls.filter((c) => c.body.op === "describe").pop();
  ok(sidCall.body.sid === "sess-a" && store.getSnapshot().sid === "sess-a", "换会话时重新 describe，带上 sid");
  ok(store.getSnapshot().sw && store.getSnapshot().sw.global === true, "describe 带回开关状态");
  const switched = await store.setSwitch("all", false, "sess-a");
  const switchCall = calls.filter((c) => c.body.op === "switch").pop();
  ok(switched === true && switchCall.body.scope === "all" && switchCall.body.enabled === false && switchCall.body.sid === "sess-a", "全部会话关闭走 op=switch");
  ok(store.getSnapshot().sw.global === false && store.getSnapshot().swSavedAt > 0, "切完状态与时间戳都更新");

  // 顶栏开关按当前范围显示：本会话读 session，全部会话读 global
  const ui = {
    cfg: { status: "ready", saving: false, swSaving: false, draft: {}, effective: fakeState.settings, defaults: {}, fixed: {}, sw: { global: true, session: false } },
    store,
  };
  const scopeBtn = () => {};
  const treeSw = T.renderPanel({ t: (k) => k, model, actions }, { ...fakeState, sid: "sess-a" }, "session", () => {}, scopeBtn, {}, ui);
  let master = null;
  walk(treeSw, ({ kind, node }) => { if (kind === "node" && node.type === "input" && node.props && node.props["data-master"]) master = node; });
  ok(Boolean(master) && master.props["data-master"] === "session" && master.props.checked === false, "本会话范围显示会话开关（关）");
  const treeAll = T.renderPanel({ t: (k) => k, model, actions }, { ...fakeState, sid: "sess-a" }, "all", () => {}, scopeBtn, {}, ui);
  let masterAll = null;
  walk(treeAll, ({ kind, node }) => { if (kind === "node" && node.type === "input" && node.props && node.props["data-master"]) masterAll = node; });
  ok(Boolean(masterAll) && masterAll.props["data-master"] === "all" && masterAll.props.checked === true, "全部会话范围显示全局开关（开）");
  const before = calls.filter((c) => c.body.op === "switch").length;
  masterAll.props.onChange({ target: { checked: false } });
  await new Promise((resolve) => setTimeout(resolve, 0));
  const flipped = calls.filter((c) => c.body.op === "switch").pop();
  ok(calls.filter((c) => c.body.op === "switch").length === before + 1 && flipped.body.scope === "all" && flipped.body.enabled === false, "点开关真的发出去");

  failNext = true;
  const failedSwitch = await store.setSwitch("session", false, "sess-a");
  ok(failedSwitch === false && store.getSnapshot().swError.includes("写不进去"), "切换失败把原因留下来");
  failNext = false;

  // 自定义档：一个 + 号、三种范围，存/套用/删都走同一条桥
  store.edit("minTokens", "12345");
  const savedPreset = await store.savePreset("session", "夜间省流");
  const presetCall = calls.filter((c) => c.body.op === "preset-save").pop();
  ok(savedPreset === true && presetCall.body.scope === "session" && presetCall.body.name === "夜间省流", "存自定义档走 op=preset-save", JSON.stringify({ savedPreset, call: presetCall && presetCall.body, snap: store.getSnapshot().presets, status: store.getSnapshot().status, err: store.getSnapshot().presetError }));
  ok(presetCall.body.values.minTokens === "12345", "存的是当前草稿");
  ok(store.getSnapshot().presets && store.getSnapshot().presets.scopes.session.items.length === 1, "存完带回最新档位列表");
  ok(store.getSnapshot().presets.layer && store.getSnapshot().presets.layer.id === "p-1", "存完这个档就在生效");
  await store.applyPreset("session", "p-1");
  const applyCall = calls.filter((c) => c.body.op === "preset-apply").pop();
  ok(applyCall.body.id === "p-1" && applyCall.body.sid === "sess-a", "套用档带 sid");
  await store.applyPreset("session", "");
  ok(calls.filter((c) => c.body.op === "preset-apply").pop().body.id === "", "空 id 等于取消套用");
  failNext = true;
  const failedPreset = await store.savePreset("all", "坏档");
  ok(failedPreset === false && store.getSnapshot().presetError.includes("写不进去"), "存档失败把原因留下来");
  failNext = false;
  await store.deletePreset("session", "p-1");
  ok(calls.filter((c) => c.body.op === "preset-delete").pop().body.id === "p-1", "删档走 op=preset-delete");

  const presetCfg = {
    status: "ready", saving: false, draft: {}, effective: fakeState.settings, defaults: {}, fixed: {},
    presetSaving: false, presetError: "", sw: { global: true, session: true },
    presets: {
      workspaceKey: "--D-ws--", workspaceKnown: true,
      scopes: {
        session: { active: "p-1", items: [{ id: "p-1", name: "夜间省流", values: { minTokens: 12345 }, createdAt: 1, updatedAt: 2 }] },
        workspace: { active: "", items: [] },
        all: { active: "", items: [] },
      },
      layer: { scope: "session", id: "p-1", name: "夜间省流" },
    },
  };
  let opened = 0, applied = [], deleted = [], confirmed = "";
  const stubStore = {
    ...store,
    applyPreset: (scope, id) => { applied.push([scope, id]); return Promise.resolve(true); },
    deletePreset: (scope, id) => { deleted.push([scope, id]); return Promise.resolve(true); },
  };
  const presetUi = {
    form: false, name: "", scope: "session", confirm: "",
    open: () => { opened += 1; }, close: () => {},
    setName: () => {}, setScope: () => {}, setConfirm: (value) => { confirmed = value; presetUi.confirm = value; },
  };
  const presetTree = T.renderPanel({ t: (k) => k, model, actions }, { ...fakeState, sid: "sess-a" }, "session", () => {}, () => {}, {}, { cfg: presetCfg, store: stubStore, preset: presetUi });
  let addBtn = null, chip = null, banner = null;
  walk(presetTree, ({ kind, node }) => {
    if (kind !== "node" || !node.props) return;
    if (node.props["data-preset-add"]) addBtn = node;
    if (node.props["data-preset-chip"]) chip = node;
    if (String(node.props.className || "").includes("sp-preset-active")) banner = node;
  });
  ok(Boolean(addBtn) && addBtn.type === "button", "自定义档右边有加号");
  addBtn.props.onClick();
  ok(opened === 1, "点加号打开新建表单");
  ok(Boolean(chip) && String(chip.props.className).includes("sp-chip-on"), "生效中的会话档 chip 高亮");
  chip.children[0].props.onClick();
  ok(applied.length === 1 && applied[0][0] === "session" && applied[0][1] === "", "点生效中的档 = 取消套用");
  chip.children[1].props.onClick();
  ok(confirmed === "p-1" && deleted.length === 0, "第一次点 × 只是要确认");
  chip.children[1].props.onClick();
  ok(deleted.length === 1 && confirmed === "", "第二次点 × 真删");
  ok(Boolean(banner) && texts(banner).includes("spine.presetLayer"), "生效中有一条明示");
  const formTree = T.renderPanel({ t: (k) => k, model, actions }, { ...fakeState, sid: "sess-a" }, "session", () => {}, () => {}, {}, { cfg: presetCfg, store: stubStore, preset: { ...presetUi, form: true, name: "新档" } });
  let nameInput = null, scopeBtns = [];
  walk(formTree, ({ kind, node }) => {
    if (kind !== "node" || !node.props) return;
    if (node.props["data-preset-name"]) nameInput = node;
    if (node.props["data-preset-scope"]) scopeBtns.push(node);
  });
  ok(Boolean(nameInput) && nameInput.props.value === "新档", "表单带名字输入框");
  ok(scopeBtns.length === 3 && scopeBtns.every((btn) => !btn.props.disabled), "三种范围都能选（工作区已识别）");
  const blindForm = T.renderPanel({ t: (k) => k, model, actions }, { ...fakeState, sid: "sess-a" }, "session", () => {}, () => {}, {}, { cfg: { ...presetCfg, presets: { ...presetCfg.presets, workspaceKnown: false } }, store: stubStore, preset: { ...presetUi, form: true, name: "" } });
  let wsBtn = null;
  walk(blindForm, ({ kind, node }) => { if (kind === "node" && node.props && node.props["data-preset-scope"] === "workspace") wsBtn = node; });
  ok(Boolean(wsBtn) && wsBtn.props.disabled === true, "工作区认不出来时那一档是灰的");

  const offline = T.createSettingsStore();
  globalThis.fetch = async () => { throw new Error("fetch failed"); };
  await offline.load();
  ok(offline.getSnapshot().status === "unavailable" && offline.getSnapshot().error.includes("fetch failed"), "连不上时状态是 unavailable 并带原因");
  globalThis.fetch = realFetch;
  globalThis.document = realDocument;
}

console.log("N. 自定义档保留手工调过的那套值");
{
  const store = T.createSettingsStore();
  ok(store.applyCustom() === false, "没手工改过时，自定义档退回生效值");
  store.edit("minTokens", "30000");
  ok(store.getSnapshot().draft.minTokens === "30000", "改一格进草稿");
  store.reset("chunkMax");
  ok(store.getSnapshot().custom && store.getSnapshot().custom.minTokens === "30000", "手工值被记住");
  ok(store.applyCustom() === true && store.getSnapshot().draft.minTokens === "30000", "点自定义档恢复手工值");
  store.setMany({ minTokens: "20000", chunkMax: "32000" });
  ok(store.getSnapshot().draft.minTokens === "20000", "点推荐档会覆盖草稿");
  store.applyCustom();
  ok(store.getSnapshot().draft.minTokens === "30000", "再点自定义档，回到手工那套而不是清空");
  store.discard();
  ok(store.applyCustom() === true && store.getSnapshot().draft.minTokens === "30000", "清空草稿后仍能恢复");
  const fresh = T.createSettingsStore();
  fresh.edit("minTokens", "21000");
  ok(fresh.getSnapshot().custom.minTokens === "21000", "新 store 各自记各自的");
}

console.log("9j. 调试卡可以提交脱敏问题日志");
{
  const diagNodes = (tree) => {
    const out = [];
    walk(tree, ({ kind, node }) => { if (kind === "node" && node.props?.["data-diag"]) out.push(node); });
    return out;
  };
  const tree = T.renderPanel({ t: (k) => k, model, actions }, fakeState, "session", () => {}, () => {}, null, { cfg: { status: "ready", draft: {}, effective: fakeState.settings, defaults: {}, diagUrl: "https://github.com/x/issues/new" } });
  const nodes = diagNodes(tree);
  ok(nodes.length === 2, "两个按钮：复制 / 去 issue（" + nodes.length + "）");
  ok(nodes.some((n) => n.props["data-diag"] === "copy" && n.props.onClick), "复制按钮可点");
  const issue = nodes.find((n) => n.props["data-diag"] === "issue");
  ok(Boolean(issue) && issue.props.disabled === false, "有诊断链接时 issue 按钮可用");
  const noUrl = T.renderPanel({ t: (k) => k, model, actions }, fakeState, "session", () => {}, () => {}, null, { cfg: { status: "ready", draft: {}, effective: fakeState.settings, defaults: {}, diagUrl: "" } });
  const blocked = diagNodes(noUrl).find((n) => n.props["data-diag"] === "issue");
  ok(Boolean(blocked) && blocked.props.disabled === true, "还没有诊断链接时置灰");
  const css = T.SPINE_CSS;
  ok(typeof css === "string" && css.length > 0, "样式存在");
}

console.log("9i. 本版更新卡 + 收尾停止线下限");
{
  const meta = T.KNOB_META.keepRoundTokens;
  ok(meta.min === 32000, "收尾停止线下限抬到 32k（不再和小刀撞在 8k）");
  ok(meta.usual[0] >= 48000, "常用区间从 48k 起：" + meta.usual.join("–"));
  ok(T.PRESETS.every((p) => Number(p.values.keepRoundTokens) > Number(p.values.chunkMax)), "三个预设的停止线都大于小刀一刀上限");
  const rangeText = T.knobRange((k) => k, "keepRoundTokens");
  ok(rangeText.includes("32.0k") && rangeText.includes("48.0k"), "面板印出新区间：" + rangeText);

  const store = new Map();
  globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) };
  const news = { entries: [
    { version: "1.3.24", date: "2026-11-26", title: "本版更新卡", bullets: ["升级后看得到改了什么", "停止线下限抬到 32k"] },
    { version: "1.3.23", date: "2026-11-25", title: "脱敏诊断", bullets: ["一键复制诊断"] },
  ] };
  const textsOf = (node) => {
    const out = [];
    const visit = (n) => {
      if (n === null || n === undefined || n === false) return;
      if (typeof n === "string") { out.push(n); return; }
      if (Array.isArray(n)) { n.forEach(visit); return; }
      (n.children || []).forEach(visit);
    };
    visit(node);
    return out;
  };
  const buttonOf = (node, flag) => {
    let hit = null;
    const visit = (n) => {
      if (!n || typeof n !== "object") return;
      if (Array.isArray(n)) { n.forEach(visit); return; }
      if (n.type === "button" && n.props && n.props[flag] !== undefined) hit = n;
      (n.children || []).forEach(visit);
    };
    visit(node);
    return hit;
  };

  hooks.length = 0;
  let closedWith = "";
  const card = T.NewsCard({ t: (k) => k, news, version: "1.3.24", open: true, onClose: (v) => { closedWith = v; } });
  ok(card && card.props && card.props["data-news"] === "1.3.24", "展开时画出本版更新卡");
  const texts = textsOf(card);
  ok(texts.includes("v1.3.24") && texts.includes("升级后看得到改了什么"), "卡里有版本号与要点");
  ok(texts.includes("spine.newsDismiss"), "有「知道了」按钮");
  // 新排版：标题行 / 版本号 / 日期 / 标题 / 要点分层，第一版没有分隔线
  const cls = (node, name) => {
    const out = [];
    const visit = (n) => {
      if (n === null || n === undefined || n === false) return;
      if (Array.isArray(n)) { n.forEach(visit); return; }
      if (typeof n !== "object") return;
      if (String(n.props?.className || "").split(" ").includes(name)) out.push(n);
      (n.children || []).forEach(visit);
    };
    visit(node);
    return out;
  };
  ok(cls(card, "sp-news-top").length === 1, "卡片顶部有独立标题行");
  ok(cls(card, "sp-news-title-main").length === 1, "标题只有一处");
  ok(cls(card, "sp-news-hint").length === 0, "不再有那句写给开发者的说明（用户不需要看）");
  ok(cls(card, "sp-news-body").length === 1, "正文区单独一层（限高滚动）");
  ok(cls(card, "sp-news-first").length === 1, "第一版标记 sp-news-first（无分隔线）");
  ok(cls(card, "sp-news-list")[0].children.length === 2, "要点按列表渲染（2 条）");
  ok(cls(card, "sp-news-ver")[0].children[0] === "v1.3.24", "版本号单独一层");

  // 右上角：文字入口在左、版本胶囊在右
  const topbar2 = T.renderPanel({ t: (k) => k, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() },
    fakeState, "session", () => {}, () => {}, { newsOpen: false });
  const entryBtn = buttonOf(topbar2, "data-news-open");
  const pill = cls(topbar2, "sp-version")[0];
  ok(Boolean(entryBtn) && textsOf(entryBtn).join("") === "spine.newsEntry", "顶栏有显式的「更新日志」按钮");
  ok(entryBtn.props["aria-expanded"] === "false" && entryBtn.props.type === "button", "收起状态 aria-expanded=false");
  ok(Boolean(pill), "版本胶囊仍在");
  const order = [];
  const walkOrder = (n) => {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(walkOrder); return; }
    if (n.props && (n.props["data-news-open"] || n.props["data-news-toggle"])) order.push(n.props["data-news-open"] ? "entry" : "pill");
    (n.children || []).forEach(walkOrder);
  };
  walkOrder(topbar2);
  ok(order.join(",") === "entry,pill", "入口在版本号左边（" + order.join(",") + "）");
  const okBtn = buttonOf(card, "data-news-ok");
  ok(Boolean(okBtn) && typeof okBtn.props.onClick === "function", "按钮挂得上事件");
  okBtn.props.onClick();
  ok(closedWith === "1.3.24", "点「知道了」交给面板收卡（并记版本）");

  ok(T.NewsCard({ t: (k) => k, news, version: "1.3.24", open: false, onClose: () => {} }) === null, "收起后不占地方");

  // 手动打开时不过滤：即使本机记过「已看过」，点开也要能看到内容（否则按钮看起来没反应）
  store.set(T.NEWS_SEEN_KEY, "1.3.24");
  hooks.length = 0;
  const reopened = T.NewsCard({ t: (k) => k, news, version: "1.3.24", open: true, onClose: () => {} });
  ok(Boolean(reopened), "看过之后手动再点开仍有内容（不再被 seen 过滤成空）");
  const reopenedTexts = textsOf(reopened);
  ok(reopenedTexts.includes("v1.3.24"), "手动重开能看到当前版要点");
  // 但「是否自动展开」仍然尊重已看过：同一版本不自动弹
  ok(T.newsShouldAuto("1.3.24") === false, "看过之后同一版本不再自动展开");
  store.delete(T.NEWS_SEEN_KEY);
  ok(T.newsShouldAuto("1.3.24") === true, "没看过就自动展开");

  ok(T.NewsCard({ t: (k) => k, news: { entries: [] }, version: "1.3.24", open: true, onClose: () => {} }) === null, "没有更新记录就不占地方");

  // 入口只给最新版（用户 2026-11-26 明确要求）：默认只画最新一条，其余藏在「历史版本」里
  hooks.length = 0;
  const latestOnly = T.NewsCard({ t: (k) => k, news, version: "1.3.24", open: true, onClose: () => {} });
  const latestTexts = textsOf(latestOnly);
  ok(latestTexts.includes("v1.3.24"), "默认展示最新版");
  ok(!latestTexts.includes("v1.3.23"), "默认不展示旧版（1.3.23 藏在历史里）");
  const historyBtn = buttonOf(latestOnly, "data-news-history");
  ok(Boolean(historyBtn), "有「历史版本」按钮");
  ok(String(textsOf(historyBtn).join("")).includes("2"), "按钮上标着总版本数");
  let toggled = 0;
  hooks.length = 0;
  const expanded = T.NewsCard({
    t: (k) => k, news, version: "1.3.24", open: true, historyOpen: true,
    onToggleHistory: () => { toggled += 1; }, onClose: () => {},
  });
  const expandedTexts = textsOf(expanded);
  ok(expandedTexts.includes("v1.3.24") && expandedTexts.includes("v1.3.23"), "展开后旧版本都在");
  const hideBtn = buttonOf(expanded, "data-news-history");
  ok(hideBtn && hideBtn.props["data-news-history"] === "hide", "展开后按钮变成「收起」");
  hideBtn.props.onClick();
  ok(toggled === 1, "点历史版本按钮会回调面板切换");

  // 宿主读不到时用内嵌要点兜底：卡片照画，并标明来源
  ok(Array.isArray(T.CLIENT_NEWS) && T.CLIENT_NEWS.length >= 2, "包内自带最近几版要点（" + T.CLIENT_NEWS.length + " 条）");
  hooks.length = 0;
  const newest = T.CLIENT_NEWS[0].version;
  const embedded = T.NewsCard({ t: (k) => k, news: { entries: T.CLIENT_NEWS }, version: newest, open: true, source: "embedded", onClose() {} });
  ok(Boolean(embedded) && embedded.props["data-news-source"] === "embedded", "内嵌要点也能画出来，且标明来源");
  const embeddedTexts = textsOf(embedded);
  ok(embeddedTexts.includes("v" + newest), "内嵌要点带着当前版本号（v" + newest + "）");
ok(T.CLIENT_NEWS.length >= 8, "内嵌要点覆盖今天的重要版本（" + T.CLIENT_NEWS.length + " 条）");
  // 发布过的版本必须都在：1.3.25 / 1.3.26 / 1.3.27 都上过 npm，不能因合并未发布版本被删掉
  for (const must of ["1.3.27", "1.3.26", "1.3.25", "1.3.24", "1.3.23", "1.3.22", "1.3.20", "1.3.19"]) {
    ok(T.CLIENT_NEWS.some((e) => e.version === must), "已发布版本 " + must + " 仍在面板要点里");
  }
ok(T.CLIENT_NEWS.every((e) => Array.isArray(e.bullets) && e.bullets.length > 0), "每条都有要点");
ok(!T.CLIENT_NEWS.some((e) => /renderPanel|slice\(|参数位|scope, bump/.test(e.title + " " + e.bullets.join(" "))), "要点里不出现函数名或参数名");
ok(T.CLIENT_NEWS.every((e) => !e.bullets.some((b) => b.length > 90)), "每条要点一句话说得完（不超 90 字）");
  hooks.length = 0;
  ok(T.NewsCard({ t: (k) => k, news: { entries: T.CLIENT_NEWS }, version: "1.3.26", open: false, source: "embedded" }) === null, "收起后不画（胶囊仍可点开）");
  ok(typeof T.newsShouldAuto("1.3.26") === "boolean", "自动展开判定是纯函数");

  // 顺序：宿主读回的条目掺在一起也必须按版本号降序，不能出现 1.3.28 排在 1.3.31 上面
  const merged = T.mergeNews([
    { version: "1.3.28", date: "2026-11-26", title: "宿主里的 28", bullets: ["x"] },
    { version: "1.3.31", date: "2026-11-26", title: "宿主里的 31", bullets: ["x"] },
    { version: "1.3.9", date: "2026-11-26", title: "老版本", bullets: ["x"] },
  ], T.CLIENT_NEWS);
  const mergedOrder = merged.map((e) => e.version);
  // 不写死版本号：每次发版 CLIENT_NEWS 的第一条就是最新，断言跟着它走。
  ok(mergedOrder[0] === T.CLIENT_NEWS[0].version, "合并不看拼接顺序，最高版本排第一：" + mergedOrder.slice(0, 3).join(" > "));
  ok(mergedOrder.indexOf("1.3.31") < mergedOrder.indexOf("1.3.28"), "1.3.31 在 1.3.28 之前");
  ok(mergedOrder.indexOf("1.3.9") > mergedOrder.indexOf("1.3.24"), "1.3.9 按数字比较排在 1.3.24 之后（不是按字符串）");
  ok(new Set(mergedOrder).size === mergedOrder.length, "没有重复版本");

  // 浮层：卡片必须包在 .sp-news-layer 里，且点开时有一层透明遮罩负责「点外面收」
  hooks.length = 0;
  const overlayTree = T.renderPanel(
    { t: (k) => k, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() },
    fakeState, "session", () => {}, () => {},
    { ask: false, ack: false },
    { cfg: { news: { entries: T.CLIENT_NEWS }, status: "ready", effective: fakeState.settings, draft: {} }, store: null, newsOpen: true, toggleNews() {}, closeNews() {} },
  );
  let layer = null, scrim = null;
  walk(overlayTree, (entry) => {
    const n = entry.node;
    if (entry.kind !== "node" || !n || !n.props) return;
    if (String(n.props.className || "").includes("sp-news-layer")) layer = n;
    if (String(n.props.className || "").includes("sp-news-scrim")) scrim = n;
  });
  ok(Boolean(layer), "更新日志包在浮层容器里（不占文档流）");
  ok(Boolean(scrim) && typeof scrim.props.onClick === "function", "点浮层外面能收起");
  hooks.length = 0;
  const panelClosed2 = T.renderPanel(
    { t: (k) => k, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() },
    fakeState, "session", () => {}, () => {},
    { ask: false, ack: false },
    { cfg: { news: { entries: T.CLIENT_NEWS }, status: "ready", effective: fakeState.settings, draft: {} }, store: null, newsOpen: false, toggleNews() {}, closeNews() {} },
  );
  let closedScrim = null;
  walk(panelClosed2, (entry) => {
    const n = entry.node;
    if (entry.kind === "node" && n && String(n.props?.className || "").includes("sp-news-scrim")) closedScrim = n;
  });
  ok(closedScrim === null, "收起时不铺遮罩（不挡下面的点击）");

  // 回归：newsOpen 必须经由 ui 传进 renderPanel，否则 open 恒为 false、按钮点了没反应。
  // 用一个「永远要求展开」的状态调用真实面板，卡片必须真的出现。
  store.set(T.NEWS_SEEN_KEY, "");
  hooks.length = 0;
  const panelOpen = T.renderPanel(
    { t: (k) => k, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() },
    fakeState, "session", () => {}, () => {},
    { ask: false, ack: false },
    { cfg: { news: { entries: news.entries }, status: "ready", effective: fakeState.settings, draft: {} }, store: null, newsOpen: true, toggleNews() {}, closeNews() {} },
  );
  let newsCard = null;
  walk(panelOpen, (entry) => {
    const n = entry.node;
    if (entry.kind === "node" && n && n.type === T.NewsCard) newsCard = n;
  });
  ok(Boolean(newsCard) && newsCard.props.open === true, "ui.newsOpen=true 时卡片真的展开（参数位没串）");
  ok(Boolean(newsCard) && typeof newsCard.props.onClose === "function", "关闭回调也接到了卡片上");

  hooks.length = 0;
  const panelClosed = T.renderPanel(
    { t: (k) => k, model: new SettingsFormModel({}, []), actions: new SettingsFormModel({}, []).actions() },
    fakeState, "session", () => {}, () => {},
    { ask: false, ack: false },
    { cfg: { news: { entries: news.entries }, status: "ready", effective: fakeState.settings, draft: {} }, store: null, newsOpen: false, toggleNews() {}, closeNews() {} },
  );
  let closedCard = null;
  walk(panelClosed, (entry) => {
    const n = entry.node;
    if (entry.kind === "node" && n && n.type === T.NewsCard) closedCard = n;
  });
  ok(Boolean(closedCard) && closedCard.props.open === false, "ui.newsOpen=false 时卡片收起");

  // 自动展开规则：没见过这个版本才弹；看过后只留顶栏那个入口
  store.delete(T.NEWS_SEEN_KEY);
  ok(T.newsShouldAuto("1.3.24") === true, "新版本第一次打开自动展开");
  store.set(T.NEWS_SEEN_KEY, "1.3.24");
  ok(T.newsShouldAuto("1.3.24") === false, "同一版本看过后不再自动展开");
  store.set(T.NEWS_SEEN_KEY, "1.3.23");
  ok(T.newsShouldAuto("1.3.24") === true, "跨版本升级仍会自动展开");
  ok(T.newsShouldAuto("") === false, "没有版本号就不展开");

  // 顶栏版本号本身就是入口：点它随时展开/收起
  const finder = (node, pred) => {
    let hit = null;
    walk(node, (entry) => { if (entry.kind === "node" && entry.node && pred(entry.node)) hit = entry.node; });
    return hit;
  };
  const badgeOf = (node) => finder(node, (n) => n.props && n.props["data-news-toggle"] !== undefined);
  let toggles = 0;
  const closedTree = T.renderPanel({ t: (k) => k, model, actions }, fakeState, "session", () => {}, () => {}, null,
    { cfg: { draft: {}, effective: {}, news }, newsOpen: false, toggleNews: () => { toggles += 1; }, closeNews: () => {} });
  const badgeBtn = badgeOf(closedTree);
  ok(Boolean(badgeBtn) && badgeBtn.type === "button", "顶栏版本号是可点的按钮");
  ok(badgeBtn.props["aria-expanded"] === "false", "收起时 aria-expanded=false");
  ok(newsElement(closedTree).props.open === false, "收起时卡片的 open 是 false");
  badgeBtn.props.onClick();
  ok(toggles === 1, "点版本号发一次切换");

  const openTree = T.renderPanel({ t: (k) => k, model, actions }, fakeState, "session", () => {}, () => {}, null,
    { cfg: { draft: {}, effective: {}, news }, newsOpen: true, toggleNews: () => {}, closeNews: () => {} });
  const openBadge = badgeOf(openTree);
  ok(openBadge && openBadge.props["aria-expanded"] === "true", "展开时 aria-expanded=true");
  ok(newsElement(openTree).props.open === true, "展开时卡片的 open 是 true");
  ok(String(openBadge.props.title).includes("spine.newsOpen"), "展开时悬停提示是「收起」");

  function newsElement(node) { return finder(node, (n) => n.type === T.NewsCard); }

}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);