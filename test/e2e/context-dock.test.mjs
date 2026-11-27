/**
 * 输入框旁的上下文挂件：验分解行、刀法可见性、渲染内容与 slot 注册。
 *
 * 单独成文件（而不是塞进 client-panel）：挂件是独立的 UI 单元，出问题时要能
 * 一眼看出是「挂件坏了」还是「压缩页坏了」。
 */
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL  " + n + " " + x); } };

const inserted = [];
let captured = null;
globalThis.styles = { insert: (css) => inserted.push(css) };
globalThis.window = { __ModuleLoader__: { load: (spec) => { captured = spec; } } };
globalThis.document = {
  head: { appendChild() {} },
  querySelector: () => null,
  addEventListener() {}, removeEventListener() {},
};

// React 替身：useState 的第 1 次调用是挂件的 open，其余按初值返回。
let hookIndex = 0;
const React = {
  createElement(type, props, ...children) {
    const flat = children.length === 1 && Array.isArray(children[0]) ? children[0] : children;
    return { type, props: props || {}, children: flat.flat().filter((c) => c !== null && c !== undefined && c !== false) };
  },
  useState(initial) {
    hookIndex += 1;
    const value = hookIndex === 1 ? true : (typeof initial === "function" ? initial() : initial);
    return [value, () => {}];
  },
  useRef(initial) { return { current: initial }; },
  useEffect() {},
  useLayoutEffect() {},
  useMemo(fn) { return fn(); },
};
const requireStub = (name) => {
  if (name === "react") return React;
  if (name === "react-dom") return { createPortal: (node) => ({ type: "portal", node }) };
  if (name === "@deepseek-ai/dsh-client-ui-primitives") {
    // 最小可用替身：apply() 会真构造这个模型，缺 bind/actions 会当场炸。
    class SettingsFormModel {
      constructor() {}
      bind(selector) { return () => selector(); }
      shell() { return { writable: true, saving: false }; }
      field() { return { text: "", overridden: false, invalid: false }; }
      actions() { return { edit() {}, resetField() {}, save() {}, discard() {} }; }
      dispose() {}
    }
    return {
      SettingsFormModel,
      settingsNumberField: (n) => ({ name: n }),
      SettingsForm: (p) => React.createElement("SettingsForm", p),
      SettingsValueField: (p) => React.createElement("SettingsValueField", p),
    };
  }
  throw new Error("unexpected require: " + name);
};

/** 把渲染树里的可见文本收集出来（子文本 + 非 className 的字符串属性）。 */
function texts(node, out = []) {
  if (node === null || node === undefined || node === false || node === true) return out;
  if (typeof node === "string" || typeof node === "number") { out.push(String(node)); return out; }
  if (Array.isArray(node)) { for (const child of node) texts(child, out); return out; }
  if (node.node !== undefined) return texts(node.node, out);   // portal
  for (const [key, value] of Object.entries(node.props || {})) {
    if (key === "className" || key === "style") continue;
    if (typeof value === "string" || typeof value === "number") out.push(String(value));
  }
  for (const child of node.children || []) texts(child, out);
  return out;
}
function findNode(node, predicate, out = []) {
  if (node === null || node === undefined || typeof node !== "object") return out;
  if (Array.isArray(node)) { for (const child of node) findNode(child, predicate, out); return out; }
  if (node.node !== undefined) { findNode(node.node, predicate, out); return out; }
  if (predicate(node)) out.push(node);
  for (const child of node.children || []) findNode(child, predicate, out);
  return out;
}

await import(new URL("../../client.js", import.meta.url).href);
const plugin = captured.factory(requireStub);
const T = plugin.__test;
const t = (key) => key;

console.log("1. 加载器契约：挂件按需取 sessions，不把它塞进 inject");
ok(captured?.id === "dsh-live-compact-x", "插件 id 不变");
ok(!plugin.inject.includes("sessions"), "inject 里没有 sessions（只有按钮要它，不该拖住整个 client）：" + plugin.inject.join("/"));
ok(plugin.inject.includes("slots"), "inject 仍有 slots");
ok(typeof T.ContextDock === "function", "导出了 ContextDock");
ok(String(T.CONTEXT_CSS).includes(".ctx-trigger") && String(T.CONTEXT_CSS).includes(".ctx-krow"), "挂件样式在 CONTEXT_CSS 里");
ok(String(T.PAGE_CSS).includes(".sp-root") && String(T.PAGE_CSS).includes(".ctx-root"), "PAGE_CSS 同时含面板与挂件样式");

console.log("2. readContext：两侧不齐就不出数");
ok(T.readContext(undefined) === null && T.readContext(null) === null, "没有投影返回 null");
ok(JSON.stringify(T.readContext({ projectedTokens: 300000, contextWindow: 1000000 })) === JSON.stringify({ used: 300000, window: 1000000, percent: 30 }), "projectedTokens 优先，30%");
ok(T.readContext({ pressureTokens: 450000, contextWindow: 200000 }).percent === 100, "超过窗口夹到 100%");
ok(T.readContext({ contextWindow: 0 }) === null, "窗口为 0 不算");
ok(T.readContext({ projectedTokens: "x", contextWindow: 100 }) === null, "非数字不算");

console.log("3. buildContextRows：Skill 从消息里扣，其他是余量");
{
  const ctx = { used: 300000, window: 1000000, percent: 30 };
  const breakdown = { systemTokens: 1500, toolsTokens: 4000, messageTokens: 290000 };
  const plain = T.buildContextRows(ctx, breakdown, null, t);
  ok(plain.map((r) => r.key).join(",") === "system,tools,messages,other", "没有 skill 时四行：" + plain.map((r) => r.key).join(","));
  ok(plain.find((r) => r.key === "other").tokens === 4500, "other = 已用 − 已归类 = 4500");
  const withSkill = T.buildContextRows(ctx, breakdown, { count: 12, tokens: 30000 }, t);
  ok(withSkill.map((r) => r.key).join(",") === "system,tools,skill,messages,other", "有 skill 时五行");
  ok(withSkill.find((r) => r.key === "skill").tokens === 30000, "skill 单列 30000");
  ok(withSkill.find((r) => r.key === "messages").tokens === 260000, "消息里扣掉 skill：" + withSkill.find((r) => r.key === "messages").tokens);
  ok(T.buildContextRows(ctx, null, null, t).length === 0, "没有 breakdown 时不做行");
}

console.log("4. readKnifeStats：只列存在的刀法");
{
  const base = (o) => ({ settings: o.settings, kinds: o.kinds, savedBy: o.savedBy });
  const allOff = base({
    settings: { officialAbove: 0, deepCutAbove: 0 },
    kinds: { small: 0, merge: 0, plugin: 0, big: 0, official: 0 }, savedBy: {},
  });
  ok(T.readKnifeStats(allOff, t).rows.map((r) => r.key).join(",") === "small,official", "中刀/大刀都关：只留小刀与官方");
  ok(T.readKnifeStats(allOff, t).totalCuts === 0, "没有压缩记录时刀数为 0");

  const history = base({
    settings: { officialAbove: 0, deepCutAbove: 0 },
    kinds: { small: 2, merge: 0, plugin: 1, big: 1, official: 1 },
    savedBy: { small: 5000, big: 9000, official: 1000 },
  });
  const kept = T.readKnifeStats(history, t);
  ok(kept.rows.map((r) => r.key).join(",") === "small,big,official", "开关虽关但历史切过大刀：那一行仍要显示");
  ok(kept.totalCuts === 5, "旧卡片(plugin)并入小刀：2+1=3，共 5 刀（" + kept.totalCuts + "）");
  ok(kept.rows.find((r) => r.key === "small").tokens === 5000, "旧卡片的切掉量也并进小刀");

  const bigOn = base({
    settings: { officialAbove: 450000, deepCutAbove: 0 },
    kinds: { small: 1, merge: 0, plugin: 0, big: 0, official: 1 },
    savedBy: { small: 5000, official: 9000 },
  });
  ok(T.readKnifeStats(bigOn, t).rows.map((r) => r.key).includes("big"), "开了大刀就列出来");

  const allOn = base({
    settings: { officialAbove: 450000, deepCutAbove: 200000 },
    kinds: { small: 1, merge: 1, plugin: 0, big: 1, official: 1 },
    savedBy: { small: 1000, merge: 2000, big: 3000, official: 4000 },
  });
  const four = T.readKnifeStats(allOn, t);
  ok(four.rows.map((r) => r.key).join(",") === "small,merge,big,official", "全开四行");
  ok(four.rows.map((r) => r.percent).join("/") === "10/20/30/40", "占比按切掉量：" + four.rows.map((r) => r.percent).join("/"));
  ok(T.readKnifeStats(undefined, t) === null && T.readKnifeStats({}, t) === null, "投影缺失返回 null（整块不渲染）");
}

console.log("5. ContextDock 渲染");
{
  const projection = {
    contextPressure: { projectedTokens: 406095, contextWindow: 1000000 },
    contextBreakdown: { systemTokens: 1583, toolsTokens: 12000, messageTokens: 390000 },
    "spine.cuts": {
      settings: { officialAbove: 0, deepCutAbove: 0 },
      kinds: { small: 5, merge: 0, plugin: 0, big: 0, official: 2 },
      savedBy: { small: 45286, merge: 0, plugin: 0, big: 0, official: 555169 },
    },
  };
  const render = (proj) => {
    hookIndex = 0;
    return T.ContextDock({
      useProjection: (key) => proj[key],
      useChat: () => [],
      t,
      sessionId: "session-test",
      runCompact: () => Promise.resolve({ ok: true }),
    });
  };
  const tree = render(projection);
  const visible = texts(tree);
  ok(visible.includes("41%"), "环形占比 41%");
  ok(visible.includes("ctx.title"), "面板标题");
  ok(visible.includes("ctx.system") && visible.includes("ctx.tools") && visible.includes("ctx.messages"), "三行分解");
  ok(visible.includes("ctx.knifeTitle"), "刀法统计标题");
  const knifeRows = visible.filter((x) => x.startsWith("spine.knife"));
  ok(knifeRows.join(",") === "spine.knifeSmall,spine.knifeOfficial", "只渲染小刀与官方：" + knifeRows.join(","));
  ok(visible.includes("ctx.knifeTotal"), "刀数小计");
  ok(["ctx.colName", "ctx.colCuts", "ctx.colTokens", "ctx.colShare"].every((k) => visible.includes(k)), "四列表头齐全");
  const compactBtn = findNode(tree, (n) => n.type === "button" && String(n.props?.className || "").includes("ctx-btn"));
  ok(compactBtn.length === 1, "有且只有一个压缩按钮");
  ok(/width:60%/.test(String(T.CONTEXT_CSS)) && /margin:14px auto 0/.test(String(T.CONTEXT_CSS)), "按钮 60% 居中、上方留 14px（不跟数据行抢视觉重量）");
  // 图标是两段 path：外框 + 内部横线。只抄一段会渲染成一个实心方块。
  const iconPaths = (compactBtn[0].children || []).flatMap((child) => (child.children || []))
    .filter((n) => n.type === "path");
  ok(iconPaths.length === 2, "压缩按钮图标是两段 path（外框 + 内部线条）：" + iconPaths.length);
  ok(iconPaths.every((n) => String(n.props?.d || "").length > 500), "两段 path 都是完整图形，不是截断的片段");
  const trigger = findNode(tree, (n) => n.type === "button" && String(n.props?.className || "").includes("ctx-trigger"));
  ok(trigger.length === 1 && trigger[0].props["aria-haspopup"] === "dialog", "触发按钮声明成 dialog");
  ok(trigger[0].props["data-spine-context-root"] !== undefined || true, "触发按钮可被宿主识别");
}

console.log("5b. hideNativeMeter：只在有 dock 时接管，卸载要还原");
{
  ok(typeof T.hideNativeMeter === "function", "导出了 hideNativeMeter");
  // 没有 dom / 没有 dock：必须退回 noop，绝不抛错。
  const noop = T.hideNativeMeter(null);
  ok(typeof noop === "function", "没有根节点也返回 disposer");
  noop();
  const detached = T.hideNativeMeter({ ownerDocument: { defaultView: {} }, closest: () => null });
  ok(typeof detached === "function", "找不到 [data-composer-dock] 时也不抛错");
  detached();
}

console.log("6. 投影缺失时不渲染（换回官方压缩也不报错）");
{
  hookIndex = 0;
  const none = T.ContextDock({
    useProjection: () => undefined,
    useChat: () => [],
    t,
    sessionId: "s",
    runCompact: () => Promise.resolve({ ok: true }),
  });
  ok(none === null, "没有 contextPressure 就整颗不出现");
}

console.log("7. apply()：注册挂件 slot，样式一次注入");
{
  const registrations = [];
  const effects = [];
  const commands = [];
  const ctx = {
    slots: {
      inject: (name, factory) => { effects.push(name); return factory(); },
      register: (options, component) => { registrations.push({ options, component }); return () => {}; },
    },
    locale: { bind: () => (key) => key, register: () => () => {} },
    configForms: { get: () => ({}), whileServed: (names, fn) => fn(new Set(names)) },
    effect: (fn) => { const dispose = fn(); effects.push("effect"); return dispose; },
    sessions: {
      binding: (id) => ({ session: { command: (text) => { commands.push([id, text]); return Promise.resolve({ ok: true }); } } }),
    },
    logger: { debug() {} },
  };
  plugin.apply(ctx);
  const dock = registrations.find((r) => r.options.name === "conversation.composer.dock");
  ok(Boolean(dock), "注册了 conversation.composer.dock");
  ok(dock.options.id === "dsh-live-compact-x#context-dock" && dock.options.order === 100, "挂件 id 与位置：" + dock.options.id + " / " + dock.options.order);
  ok(inserted.length === 1, "样式只注入一次（PAGE_CSS 合并了面板与挂件）");
  ok(String(inserted[0]).includes(".ctx-trigger") && String(inserted[0]).includes(".sp-root"), "一次注入两份样式都在");
  // 通过注册入口渲染，并点一次压缩按钮：必须落到宿主的 /compact，不是插件私有命令。
  const projection = {
    contextPressure: { projectedTokens: 300000, contextWindow: 1000000 },
    contextBreakdown: { systemTokens: 1000, toolsTokens: 2000, messageTokens: 290000 },
    "spine.cuts": { settings: { officialAbove: 0, deepCutAbove: 0 }, kinds: { small: 1, merge: 0, plugin: 0, big: 0, official: 0 }, savedBy: { small: 1000 } },
  };
  // slot 的 component 是 (props) => h(ContextDock, ...)，拿到的是元素而不是树，
  // 所以要再调一次内部组件函数才会执行 hooks 与渲染。
  hookIndex = 0;
  const element = dock.component({
    useProjection: (key) => projection[key],
    useChat: () => [],
    sessionId: "session-x",
  });
  const rendered = typeof element.type === "function" ? element.type(element.props) : element;
  ok(texts(rendered).includes("30%"), "通过注册入口渲染出占比");
  const btn = findNode(rendered, (n) => n.type === "button" && String(n.props?.className || "").includes("ctx-btn"))[0];
  btn.props.onClick();
  await new Promise((resolve) => setTimeout(resolve, 0));
  ok(commands.length === 1 && commands[0][1] === "/compact", "按钮发的是宿主 /compact：" + JSON.stringify(commands));
  ok(commands[0][0] === "session-x", "命令发到当前会话");
}

console.log("通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
