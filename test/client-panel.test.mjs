/** 浏览器半边：在假加载器里跑起来，验统计、验面板渲染、验注册。 */
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL  " + n + " " + x); } };

const inserted = [];
let captured = null;
globalThis.styles = { insert: (css) => inserted.push(css) };
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };

// React 极简替身：只要能把树建出来就够检查内容
const React = {
  createElement(type, props, ...children) {
    const flat = children.length === 1 && Array.isArray(children[0]) ? children[0] : children;
    return { type, props: props || {}, children: flat.flat().filter((c) => c !== null && c !== undefined && c !== false) };
  },
  useState(initial) { return [typeof initial === "function" ? initial() : initial, () => {}]; },
};

class SettingsFormModel {
  constructor(ledger, fields) { this.ledger = ledger; this.fields = fields; this.saved = 0; this.discarded = 0; }
  bind(selector) { return () => selector(); }
  shell() { return { writable: true, saving: false }; }
  field(name) { return { value: "", overridden: false }; }
  actions() { return { edit() {}, resetField() {}, save: () => { this.saved += 1; }, discard: () => { this.discarded += 1; } }; }
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

console.log("3. 统计口径");
const cuts = [
  { id: "a", kind: "spine", tokens: 4000, start: 10, end: 20, time: 1000, rawNames: ["f1"], model: "m" },
  { id: "b", kind: "official", tokens: 60000, start: 100, end: 900, time: 2000, rawNames: [], model: "m" },
  { id: "c", kind: "spine", tokens: 0, start: 0, end: 0, time: 3000, rawNames: ["f2", "f3"], model: "" },
];
const stats = T.summarizeCuts(cuts);
ok(stats.count === 3 && stats.total === 64000, "刀数与总量 " + stats.total);
ok(stats.spineCount === 2 && stats.spineTokens === 4000, "我方 2 刀 / 4000");
ok(stats.officialCount === 1 && stats.officialTokens === 60000, "官方 1 刀 / 60000");
ok(stats.average === 21333, "平均每刀 " + stats.average);
ok(stats.biggest.id === "b", "最大一刀是 b");
ok(stats.files === 3, "备份文件总数 " + stats.files);
ok(stats.first.id === "a" && stats.last.id === "c", "首尾顺序按时间线");
ok(T.summarizeCuts([]).count === 0 && T.summarizeCuts(null).total === 0, "空输入不抛错");

console.log("4. 构成条");
const segs = T.barSegments(cuts);
ok(segs.length === 2, "0 token 的刀不进构成条");
ok(segs[0].color !== segs[1].color, "小刀/官方用不同颜色");
ok(Math.abs(segs.reduce((s, x) => s + x.share, 0) - 1) < 1e-9, "占比之和为 1");
ok(segs.every((x) => x.width > 0), "最小可见宽度 > 0");
ok(T.barSegments([{ tokens: 0 }, { tokens: 0 }]).length === 0, "全是 0 时没有构成条");

console.log("5. 面板渲染（React 替身）");
// 真 React 会在此刻调用函数组件；替身也要展开展开，否则统计只停在壳上。
const walk = (node, visit) => {
  if (node === null || node === undefined || node === false) return;
  if (typeof node === "string" || typeof node === "number") { visit({ kind: "text", value: String(node) }); return; }
  if (Array.isArray(node)) { for (const item of node) walk(item, visit); return; }
  if (typeof node !== "object") return;
  if (typeof node.type === "function") { walk(node.type(node.props || {}), visit); return; }
  visit({ kind: "node", node });
  for (const child of node.children || []) walk(child, visit);
};
const texts = (tree) => { const out = []; walk(tree, (n) => { if (n.kind === "text") out.push(n.value); }); return out.join(" "); };
const fakeState = { saved: 64000, spine: 2, official: 1, shadowDir: "C:\\shadow\\s1", cuts };
const model = new SettingsFormModel({}, []);
const actions = model.actions();
const tree = T.SpinePanel({ t: (key) => key, useProjection: () => fakeState, model, actions });
const text = texts(tree);
ok(text.includes("64.0k"), "KPI 显示累计切掉：" + text.slice(0, 80));
ok(text.includes("21.3k"), "平均显示成 21.3k");
const empty = T.SpinePanel({ t: (key) => key, useProjection: () => undefined });
ok(texts(empty).includes("spine.unavailable"), "没有投影时给提示而不是崩");
let rows = 0; let knobs = 0; let saveBtn = null;
walk(tree, (entry) => {
  const n = entry.node;
  if (!n) return;
  if (n.props?.className === "sp-row") rows += 1;
  if (n.props?.id && String(n.props.id).startsWith("spine-knob-")) knobs += 1;
  if (n.props?.className === "sp-btn sp-btn-primary") saveBtn = n;
});
ok(rows === 3, "时间线三行（" + rows + "）");
ok(knobs === 15, "刀把共 15 个旋钮（" + knobs + "）");
ok(Boolean(saveBtn), "有保存按钮");
saveBtn?.props?.onClick?.();
ok(model.saved === 1, "点保存真的调了 save()");

console.log("6. apply()：样式注入与页签注册");
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
const view = registrations.find((r) => r.options.name === "conversation.view");
ok(Boolean(view), "注册了 conversation.view");
ok(view.options.id === "dsh-live-compact-x#cuts" && view.options.order === 25, "id 与位置 " + view.options.id + " / " + view.options.order);
ok(typeof view.options.label === "function" && view.options.label() === "tab.spine", "标签是本地化函数");
const rendered = view.component({ useProjection: () => fakeState });
ok(texts(rendered).includes("64.0k"), "通过注册入口也能渲染出统计");
const settingsRow = registrations.find((r) => r.options.name === "plugins.row.config");
ok(Boolean(settingsRow), "设置页那条还在，没被面板挤掉");

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
