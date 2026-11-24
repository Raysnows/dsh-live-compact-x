import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const work = mkdtempSync(join(tmpdir(), "spine-zero-"));
process.env.DSH_HOME = work;
process.env.SPINE_SHADOW_DIR = join(work, "compaction-spine", "shadow");
writeFileSync(join(work, "spine-switch.json"), JSON.stringify({ enabled: true, disabled: [] }));

const { default: Engine } = await import("../index.js");
let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + " " + x); } };

function harness() {
  const engine = Object.create(Engine.prototype);
  engine.sessionState = new Map();
  engine.rawSeen = new Map();
  engine.calls = [];
  engine.saveShadowAsync = async (...args) => { engine.calls.push(args); return { ok: true }; };
  return engine;
}
const agent = { session: { id: "session-zero-copy" } };
const msg = (text) => ({ role: "tool", toolCallId: "call-z", content: [{ type: "text", text }] });

console.log("1. 没有 shadowFile：绝不调用写盘");
{
  const engine = harness();
  const out = await engine.summarize({ messages: [msg("完整原文")], liveCompact: { card: { ok: true, text: "卡片", needsBackup: false } } }, agent);
  ok(out.provider === "local" && out.model === "spine-extract", "走本地卡片");
  ok(engine.calls.length === 0, "saveShadowAsync 调用 0 次（旧代码会调用 1 次）");
  ok(out.summary[0].text === "卡片", "卡片原文不被改写");
}

console.log("2. 有 shadowFile：只写指定路径");
{
  const engine = harness();
  const file = join(work, "cut-test.txt");
  engine.saveShadowAsync = async (...args) => { engine.calls.push(args); writeFileSync(file, "备份"); return { ok: true }; };
  const out = await engine.summarize({ messages: [msg("完整原文")], liveCompact: { card: { ok: true, text: "卡片", needsBackup: true, shadowFile: file } } }, agent);
  ok(engine.calls.length === 1 && engine.calls[0][2] === file, "只写指定备份路径");
  ok(out.summary[0].text === "卡片", "备份正常时原文不变");
}

console.log("3. 已被修剪但没有副本：拒绝静默放行");
{
  const engine = harness();
  let error = "";
  try {
    await engine.summarize({ messages: [msg("HEAD [... tool result middle pruned ...] TAIL")], liveCompact: { card: { ok: true, text: "卡片", needsBackup: false } } }, agent);
  } catch (e) { error = String(e?.message || e); }
  ok(error.includes("pruned span has no local backup"), "明确拒绝：" + error);
  ok(engine.calls.length === 0, "拒绝时也不写盘");
}

console.log("4. needsBackup 但没有路径仍拒绝");
{
  const engine = harness();
  let error = "";
  try { await engine.summarize({ messages: [msg("x")], liveCompact: { card: { ok: true, text: "卡片", needsBackup: true } } }, agent); }
  catch (e) { error = String(e?.message || e); }
  ok(error.includes("backup path missing"), "保留原有完整性断言：" + error);
}

console.log("5. 不 stub 写盘函数：真实文件系统也不产生副本");
{
  const engine = Object.create(Engine.prototype);
  engine.sessionState = new Map();
  engine.rawSeen = new Map();
  const out = await engine.summarize({ messages: [msg("真实原文")], liveCompact: { card: { ok: true, text: "卡片", needsBackup: false } } }, agent);
  ok(out.provider === "local", "无 shadowFile 时仍正常出卡");
  const shadow = join(work, "compaction-spine", "shadow");
  const files = existsSync(shadow) ? readdirSync(shadow, { recursive: true }).filter((name) => /\.(txt|json)$/.test(String(name))) : [];
  ok(files.length === 0, "磁盘没有 shadow / cut / raw 副本：" + files.join(", "));
}

rmSync(work, { recursive: true, force: true });
console.log("\n通过 " + pass + " / 失败 " + fail);
if (fail) process.exitCode = 1;
