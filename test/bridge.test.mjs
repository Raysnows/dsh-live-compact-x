/** 设置桥：写的是引擎真读的那份文件，拒绝不该写的键，也不让外站碰到。 */
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL  " + n + " " + x); } };

import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "spine-bridge-"));
const file = join(dir, "spine-settings.json");
process.env.SPINE_SETTINGS_FILE = file;
process.env.SPINE_PRESETS_FILE = join(dir, "spine-presets.json");
const sessionsDir = join(dir, "sessions");
process.env.SPINE_SESSIONS_DIR = sessionsDir;
mkdirSync(join(sessionsDir, "--D-ws--", "sess-a"), { recursive: true });
mkdirSync(join(sessionsDir, "--D-ws--", "session-sess-b"), { recursive: true });

const settings = await import("../settings.js");
const bridge = await import("../bridge.js");

const readJson = () => JSON.parse(readFileSync(file, "utf8"));
writeFileSync(file, JSON.stringify({ minNetGain: 3000, bigGate: 650000 }));
writeFileSync(join(dir, "README.md"), "# Spine tests");
writeFileSync(join(dir, "CHANGELOG.md"), "## 1.0.0");

console.log("1. 文件层的读写");
{
  ok(settings.settingsFilePath() === file, "路径来自 SPINE_SETTINGS_FILE");
  ok(settings.readOverrides().minNetGain === 3000, "读到现有覆盖值");
  await settings.writeOverrides({ minNetGain: 4321, deepCutAbove: null });
  ok(readJson().minNetGain === 4321, "写入生效");
  ok(!Object.prototype.hasOwnProperty.call(readJson(), "deepCutAbove"), "null = 删除这一项");
  ok(!existsSync(file + ".tmp"), "不留临时文件");

  let threw = "";
  try { await settings.writeOverrides({ nope: 1 }); } catch (error) { threw = error.message; }
  ok(threw.includes("unknown setting"), "不认识的键直接拒绝：" + threw);
  threw = "";
  try { await settings.writeOverrides({ minNetGain: "abc" }); } catch (error) { threw = error.message; }
  ok(threw.includes("finite number"), "非数字直接拒绝：" + threw);
  threw = "";
  try { await settings.writeOverrides({ bigGate: -1 }); } catch (error) { threw = error.message; }
  ok(threw.includes("between 0"), "负数直接拒绝：" + threw);
  ok(readJson().bigGate === 650000, "拒绝之后文件没被动过");

  await settings.writeOverrides({ keepRounds: 0 });
  ok(readJson().keepRounds === 1, "轮数下限兜到 1");
  const described = settings.describeSettings({ minTokens: 30000 });
  ok(described.effective.minTokens === 30000, "config 优先于文件");
  ok(described.effective.minNetGain === 4321, "文件优先于默认");
  ok(described.fixed.minTokens === 30000, "被 config 固定的字段单独标出来");
  ok(described.defaults.minNetGain === 3000 && described.file === file, "默认值与原样路径");
}

console.log("2. 路由注册与守卫");
let route = null;
const sctx = {
  get: (name) => name === "webServer" ? { register: (r) => { route = r; return () => { route = null; }; } } : undefined,
  effect: (fn) => { fn(); return () => {}; },
};
const ctx = {
  inject: (deps, cb) => { ok(deps.includes("webServer"), "只等 webServer 一个可选服务"); cb(sctx); },
  get: (name) => name === "webServer" ? sctx.get("webServer") : undefined,
  logger: { debug() {} },
};
bridge.installSettingsBridge(ctx, {
  getConfig: () => ({}),
  docs: { readme: join(dir, "README.md"), changelog: join(dir, "CHANGELOG.md") },
});
ok(route && route.kind === "exact" && route.path === "/api/dsh-live-compact-x-settings", "注册 exact 路由：" + (route && route.path));

const call = async (body, headers = { host: "127.0.0.1:7124", "sec-fetch-site": "same-origin" }) => {
  const req = Object.assign((async function* () { yield Buffer.from(typeof body === "string" ? body : JSON.stringify(body)); })(), {
    method: "POST", headers, socket: { remoteAddress: "127.0.0.1" },
  });
  const out = { status: 0, text: "" };
  const res = { writeHead: (status) => { out.status = status; }, end: (text) => { out.text = text; } };
  await route.handler(req, res);
  return { status: out.status, json: JSON.parse(out.text || "{}") };
};

{
  const r = await call({ op: "describe" });
  ok(r.status === 200 && r.json.ok && r.json.value.effective.minNetGain === 4321, "describe 回生效值");
  const saved = await call({ op: "save", patch: { officialAbove: 260000 } });
  ok(saved.status === 200 && saved.json.ok, "save 成功");
  ok(readJson().officialAbove === 260000, "save 真的落盘");
  ok(saved.json.value.savedAt > 0, "带回保存时间");

  const bad = await call({ op: "save", patch: "nope" });
  ok(bad.status === 400 && bad.json.code === "bad-request", "patch 不是对象就 400");

  const doc = await call({ op: "doc", which: "readme" });
  ok(doc.json.ok && doc.json.value.text === "# Spine tests" && doc.json.value.truncated === false, "doc 读回正文");
  const missingDoc = await call({ op: "doc", which: "nope" });
  ok(missingDoc.json.value.available === true, "未知 which 退回 README，不给空手");

  const unknown = await call({ op: "???" });
  ok(unknown.status === 400 && unknown.json.code === "bad-request", "未知 op 400");

  const crossSite = await call({ op: "describe" }, { host: "127.0.0.1:7124", "sec-fetch-site": "cross-site" });
  ok(crossSite.status === 403, "跨站请求 403");
  const foreignOrigin = await call({ op: "describe" }, { host: "127.0.0.1:7124", origin: "http://evil.example.com" });
  ok(foreignOrigin.status === 403, "外站 origin 403");
  const foreignHost = await call({ op: "describe" }, { host: "evil.example.com", origin: "http://evil.example.com" });
  ok(foreignHost.status === 403, "外站 host 403");

  const req = Object.assign((async function* () { yield Buffer.from("{}"); })(), { method: "GET", headers: { host: "127.0.0.1:7124" }, socket: { remoteAddress: "127.0.0.1" } });
  const out = { status: 0, text: "" };
  await route.handler(req, { writeHead: (s) => { out.status = s; }, end: (t) => { out.text = t; } });
  ok(out.status === 405, "GET 405");
}

console.log("3. 宿主鉴权优先");
{
  const guarded = [];
  const ctx2 = {
    inject: (deps, cb) => cb({
      get: (name) => name === "webServer" ? { register: (r) => { guarded.push(r); return () => {}; } } : name === "connection" ? { requestRejection: (req) => req.headers["x-token"] === "ok" ? undefined : 401 } : undefined,
      effect: (fn) => { fn(); return () => {}; },
    }),
    get: (name) => name === "webServer" ? { register: (r) => { guarded.push(r); return () => {}; } } : undefined,
    logger: { debug() {} },
  };
  bridge.installSettingsBridge(ctx2, { getConfig: () => ({}), docs: {} });
  const handler = guarded[0].handler;
  const make = (headers) => {
    const req = Object.assign((async function* () { yield Buffer.from(JSON.stringify({ op: "describe" })); })(), { method: "POST", headers, socket: { remoteAddress: "127.0.0.1" } });
    const out = { status: 0, text: "" };
    return { req, res: { writeHead: (s) => { out.status = s; }, end: (t) => { out.text = t; } }, out };
  };
  const denied = make({ host: "127.0.0.1:7124", "sec-fetch-site": "same-origin" });
  await handler(denied.req, denied.res);
  ok(denied.out.status === 401, "宿主判 401 就 401");
  const allowed = make({ host: "127.0.0.1:7124", "sec-fetch-site": "same-origin", "x-token": "ok" });
  await handler(allowed.req, allowed.res);
  ok(allowed.out.status === 200, "宿主放行才继续");
}

console.log("4. 总开关：本会话 / 全部会话");
{
  process.env.SPINE_SWITCH_FILE = join(dir, "spine-switch.json");
  const d = await call({ op: "describe", sid: "sess-a" });
  ok(d.json.value.switch && d.json.value.switch.global === true && d.json.value.switch.session === true, "describe 带回开关状态");
  ok(String(d.json.value.switch.file).endsWith("spine-switch.json"), "开关文件路径也带回来");

  const offAll = await call({ op: "switch", scope: "all", enabled: false, sid: "sess-a" });
  ok(offAll.json.ok && offAll.json.value.switch.global === false, "全部会话关闭");
  ok(existsSync(join(dir, "spine-switch.json")), "开关落盘");
  const after = await call({ op: "describe", sid: "sess-a" });
  ok(after.json.value.switch.global === false && after.json.value.switch.session === false, "再看一遍还是关");

  await call({ op: "switch", scope: "all", enabled: true, sid: "sess-a" });
  const offOne = await call({ op: "switch", scope: "session", enabled: false, sid: "sess-a" });
  ok(offOne.json.value.switch.session === false && offOne.json.value.switch.global === true, "只关本会话");
  const other = await call({ op: "describe", sid: "sess-b" });
  ok(other.json.value.switch.session === true, "别的会话不受影响");

  const badScope = await call({ op: "switch", scope: "nope", enabled: true, sid: "s" });
  ok(badScope.status === 400 && badScope.json.code === "bad-request", "未知范围 400");
  const badEnabled = await call({ op: "switch", scope: "all", enabled: "yes" });
  ok(badEnabled.status === 400, "非布尔 400");
  const noSid = await call({ op: "switch", scope: "session", enabled: false });
  ok(noSid.json.ok === false && String(noSid.json.message).includes("会话 ID"), "没给会话 ID 不写");
}

console.log("5. 自定义档：本会话 / 本工作区 / 全部会话");
{
  const empty = await call({ op: "describe", sid: "sess-a" });
  ok(empty.json.value.presets && empty.json.value.presets.workspaceKey === "--D-ws--", "describe 带回工作区标识");
  ok(empty.json.value.presets.scopes.session.items.length === 0, "一开始没有自定义档");
  ok(empty.json.value.presets.workspaceKnown === true, "工作区可用");

  const created = await call({ op: "preset-save", scope: "session", sid: "sess-a", name: "夜间省流", values: { minTokens: 12345, officialAbove: 300000 } });
  ok(created.json.ok && created.json.value.presets.scopes.session.items.length === 1, "存下本会话档");
  ok(created.json.value.effective.minTokens === 12345, "存完立刻生效");
  ok(created.json.value.presets.layer && created.json.value.presets.layer.scope === "session", "快照说清生效的是会话档");

  const other = await call({ op: "describe", sid: "sess-b" });
  ok(other.json.value.effective.minTokens === 20000, "别的会话不受影响");
  ok(other.json.value.presets.scopes.session.items.length === 0, "别的会话看不到这条档");

  const wrote = await call({ op: "save", sid: "sess-a", patch: { minTokens: 15000 } });
  ok(wrote.json.ok && wrote.json.value.target && wrote.json.value.target.scope === "session", "保存写回生效中的档");
  ok(readJson().minTokens === undefined, "没有动全局设置文件");
  ok(wrote.json.value.effective.minTokens === 15000, "改的是这个档的值");

  const ws = await call({ op: "preset-save", scope: "workspace", sid: "sess-a", name: "工作区档", values: { minTokens: 7777 } });
  ok(ws.json.ok && ws.json.value.presets.scopes.workspace.items.length === 1, "工作区档存下来了");
  const peer = await call({ op: "describe", sid: "sess-b" });
  ok(peer.json.value.effective.minTokens === 7777, "同工作区的会话也吃工作区档");

  const all = await call({ op: "preset-save", scope: "all", sid: "sess-a", name: "全站", values: { bigGate: 600000 } });
  const lonely = await call({ op: "describe", sid: "sess-z" });
  ok(all.json.ok && lonely.json.value.effective.bigGate === 600000, "全部会话档对谁都生效");
  ok(lonely.json.value.presets.workspaceKnown === false, "没工作区的会话如实说");

  const cleared = await call({ op: "preset-apply", scope: "session", sid: "sess-a", id: "" });
  ok(cleared.json.ok && cleared.json.value.effective.minTokens === 7777, "取消会话档后落到工作区档");
  const wrong = await call({ op: "preset-apply", scope: "session", sid: "sess-a", id: "p-nope" });
  ok(wrong.status === 400 && String(wrong.json.message).includes("不存在"), "不存在的档 400");
  const badName = await call({ op: "preset-save", scope: "session", sid: "sess-a", name: "", values: { minTokens: 1 } });
  ok(badName.status === 400 && String(badName.json.message).includes("档名"), "空档名 400");
  const badWs = await call({ op: "preset-save", scope: "workspace", sid: "sess-z", name: "x", values: { minTokens: 1 } });
  ok(badWs.status === 400 && String(badWs.json.message).includes("工作区"), "认不出工作区就 400");
  const noSid = await call({ op: "preset-save", scope: "session", name: "x", values: { minTokens: 1 } });
  ok(noSid.status === 400 && String(noSid.json.message).includes("会话 ID"), "没会话 ID 400");
  const del = await call({ op: "preset-delete", scope: "session", sid: "sess-a", id: "p-nope" });
  ok(del.status === 400, "删不存在的档 400");
}

console.log("8. 脱敏诊断（op=diag）");
{
  const diag = (await call({ op: "diag", sid: "sess-a" })).json;
  ok(diag.ok === true && diag.value && typeof diag.value.text === "string", "返回诊断文本 " + JSON.stringify(diag).slice(0, 200));
  ok(diag.value.text.includes("插件诊断"), "有标题");
  ok(diag.value.text.length <= 8000, "长度受限：" + diag.value.text.length);
  ok(diag.value.url.startsWith("https://github.com/Raysnows/dsh-live-compact-x/issues/new?"), "给出新建 issue 链接");
  ok(diag.value.url.includes("body="), "链接带预填 body");
  ok(!/C:\\Users\\|\\AppData\\|\/home\//.test(diag.value.text), "不含本机家目录");
  ok(!/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(diag.value.text), "会话 id 被抹掉");
  ok(!/(sk-|Bearer )/.test(diag.value.text), "不含 token");
  ok(diag.value.text.includes("生效值"), "带生效设置");
  ok(diag.value.text.includes("最近决策"), "带决策摘要");
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
