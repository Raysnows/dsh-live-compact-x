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
};

class SettingsFormModel {
  constructor(ledger, fields) { this.ledger = ledger; this.fields = fields; this.saved = 0; this.discarded = 0; this.edits = []; }
  bind(selector) { return () => selector(); }
  shell() { return { writable: true, saving: false }; }
  field(name) { return { value: "", overridden: false }; }
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

await import("file:///D:/deepseek-workspaces/work/plugins/dsh-live-compact-x/client.js");
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
ok(/^\d{2}:\d{2}:\d{2}$/.test(T.fmtClock(Date.now())), "时间格式 HH:MM:SS");

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
ok(!texts(errTree).includes("spine.error") && texts(errTree).includes("spine.knobs"), "shell 抛错时降级成只读，不白屏");
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
saveBtn?.props?.onClick?.();
ok(model.saved === 1, "点保存真的调了 save()");

// 刀把必须是最后一张卡（中刀是实验性功能，放最后）
const sections = [];
walk(tree, (entry) => {
  const n = entry.node;
  if (!n) return;
  if (n.type === "details" && n.props?.className === "sp-details sp-card") sections.push("debug");
  if (n.props?.className === "sp-card" && typeof n.type === "string") {
    const title = (n.children || []).find((c) => c && c.props && c.props.className === "sp-card-title");
    const label = [];
    if (title) walk(title, (x) => { if (x.kind === "text") label.push(x.value); });
    if (label.length) sections.push(label[0]);
  }
});
const uniqueSections = sections.filter((s, i) => sections.indexOf(s) === i);
ok(uniqueSections[uniqueSections.length - 2] === "spine.knobs", "刀把在文档卡之后：" + uniqueSections.join("|"));
ok(uniqueSections[uniqueSections.length - 1] === "debug", "调试台在最后且收起");
const knobOrder = T.KNOB_GROUPS.map((g) => g.id).join(",");
ok(knobOrder === "small,mid,big", "中刀排在小刀之后、大刀之前（" + knobOrder + "）");
ok(T.KNOB_GROUPS.find((g) => g.id === "mid").experimental === true, "中刀标了实验性");
ok(T.KNOB_GROUPS.find((g) => g.id === "mid").enable === "deepCutAbove", "中刀有独立开关（deepCutAbove）");

console.log("8. 实验性开关");
const model2 = new SettingsFormModel({}, []);
hooks.length = 0;
const tree2 = T.SpinePanel({ t: (key) => key, useProjection: () => fakeState, model: model2, actions: model2.actions() });
let toggle = null;
walk(tree2, (entry) => {
  const n = entry.node;
  if (!n) return;
  if (n.type === "input" && n.props?.type === "checkbox") toggle = n;
});
ok(Boolean(toggle), "有中刀开关");
ok(toggle.props.checked === true, "deepCutAbove=120000 时开关是开的");
toggle.props.onChange({ target: { checked: false } });
ok(model2.edits.some(([name, text]) => name === "deepCutAbove" && text === "0"), "关掉开关写 deepCutAbove=0");
const offState = { ...fakeState, settings: { ...fakeState.settings, deepCutAbove: 0 } };
hooks.length = 0;
const tree3 = T.SpinePanel({ t: (key) => key, useProjection: () => offState, model: model2, actions: model2.actions() });
let toggle3 = null;
walk(tree3, (entry) => { const n = entry.node; if (n && n.type === "input" && n.props?.type === "checkbox") toggle3 = n; });
ok(toggle3.props.checked === false, "deepCutAbove=0 时开关是关的");
toggle3.props.onChange({ target: { checked: true } });
ok(model2.edits.some(([name, text]) => name === "deepCutAbove" && text === String(T.MID_ON)), "打开开关写回默认门槛 " + T.MID_ON);

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
  ok(texts(t2).includes("spine.knobs"), "没有设置值也给旋钮区");
  let inputs = 0;
  walk(t2, (entry) => { const n = entry.node; if (n && n.type === "input" && n.props?.type === "number") inputs += 1; });
  ok(inputs === 15, "15 个数字输入仍然渲染（" + inputs + "）");
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
  configForms: { get: () => ({}), whileServed: (names, fn) => fn() },
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
const settingsRow = registrations.find((r) => r.options.name === "plugins.row.config");
ok(Boolean(settingsRow), "设置页那条还在，没被面板挤掉");

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);