import { appendFileSync, copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { makeTemp } from "../fixtures/temp.mjs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

const work = makeTemp("wire-"); 
const home = join(work, ".dsh");
const sessions = join(home, "sessions");
const slug = join(sessions, "proj");
const sid = "session-wiretest-0001";
const sdir = join(slug, sid);
mkdirSync(sdir, { recursive: true });
const log = join(sdir, "session.v4.jsonl.zstd");
// 夹具：给了真实会话日志就用它；没给就造一份，干净 clone / CI 也能跑。
const SRC = process.argv[2];
if (SRC && existsSync(SRC)) {
  copyFileSync(SRC, log);
} else {
  writeFileSync(log, zstdCompressSync(Buffer.from(JSON.stringify({
    type: "user/message",
    seq: 90000,
    data: { message: { role: "user", content: [{ type: "text", text: "接线测试：会话开始" }] }, source: { kind: "user" } },
  }) + "\n", "utf8")));
}
function frame(body) { return zstdCompressSync(Buffer.from(body + "\n", "utf8")); }
const TEXT = "V2 接线测试正文 " + "q".repeat(4000);
appendFileSync(log, frame(JSON.stringify({ type: "tool/result", seq: 90001, data: { message: { toolCallId: "call_wire_1", content: [{ type: "text", text: TEXT }] } } })));

process.env.DSH_HOME = home;
process.env.SPINE_STORE = "v2";
process.env.SPINE_SESSIONS_DIR = sessions;

const raw = await import(new URL("../../src/engine/raw.js", import.meta.url));
let pass = 0, fail = 0;
const ok = (c, n, extra = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + " " + extra); } };

const shadow = join(home, "compaction-spine", "shadow");
const dir = join(shadow, sid);
mkdirSync(dir, { recursive: true });

console.log("1. capture（不写正文）");
const rec = raw.captureOwnedToolResult({ dir, toolCallId: "call_wire_1", text: TEXT, seq: 90001, pathLabel: "wire.log" });
ok(rec.ok === true, "capture 成功", JSON.stringify(rec).slice(0, 200));
ok(rec.kind === "v2" && rec.path === "log:" + sid + "#90001", "记录是 v2 伪路径：" + rec.path);
ok(!existsSync(join(dir, raw.rawName("call_wire_1"))), "没有生成 raw-*.txt 副本");
ok(existsSync(join(home, "compaction-spine", "index.jsonl")), "索引文件已写入");

console.log("2. verifiedRaw（回读日志）");
const v = raw.verifiedRaw(rec);
ok(v.ok === true && v.text === TEXT, "回读内容一致（" + (v.text || "").length + " 字符）");

console.log("3. readRawToolResult");
const r = raw.readRawToolResult({ dir, toolCallId: "call_wire_1" });
ok(r.ok === true && r.seq === 90001, "按 id 查回索引");

console.log("4. 指针文案");
const ptr = raw.pointerFor(rec);
ok(ptr.includes("log:" + sid + "#90001") && ptr.includes("字节"), "卡片指针：" + ptr.slice(0, 90));

console.log("5. 被修剪的文本不写索引");
const pruned = raw.captureOwnedToolResult({ dir, toolCallId: "call_pruned", text: "abc " + raw.PRUNE_MARKER + " def", seq: 90002 });
ok(pruned.ok === false && pruned.reason === "already-pruned", "拒绝把修剪后文本当原文");

console.log("6. 日志缺失时退回 v1（安全网）");
const ghost = join(shadow, "session-does-not-exist");
mkdirSync(ghost, { recursive: true });
const rec2 = raw.captureOwnedToolResult({ dir: ghost, toolCallId: "call_wire_2", text: "无日志的结果", seq: 90003 });
ok(rec2.ok === false && rec2.reason === "missing-session-log", "找不到会话日志 -> fail-closed（" + rec2.reason + "）");
ok(!existsSync(join(ghost, raw.rawName("call_wire_2"))), "不写影子文件，也不触发 ACL");

console.log("7. 修剪兜底穿透到 verifiedRaw");
{
  const { defaultV2 } = await import(new URL("../../src/recall/store-switch.js", import.meta.url));
  const backend = defaultV2();
  const original = "HEAD 原始正文 " + "m".repeat(2000) + " TAIL";
  const prunedText = "HEAD " + raw.PRUNE_MARKER + " TAIL";
  appendFileSync(log, frame(JSON.stringify({ type: "tool/result", seq: 90010, data: { message: { toolCallId: "call_wire_3", content: [{ type: "text", text: prunedText }] } } })));
  const { sha16 } = await import(new URL("../../src/recall/recall.js", import.meta.url));
  backend.fallback.put(original);
  backend.index.append({ id: "call_wire_3", seq: 90010, session: sid, sha: sha16(original), bytes: Buffer.byteLength(original) });
  const record = { ok: true, kind: "v2", sessionId: sid, seq: 90010, toolCallId: "call_wire_3", sha256: sha16(original), sha16: sha16(original), bytes: Buffer.byteLength(original), path: "log:" + sid + "#90010" };
  const v3 = raw.verifiedRaw(record);
  ok(v3.ok === true && v3.text === original, "日志只剩 marker 时，从兜底副本还原原文");
}

rmSync(work, { recursive: true, force: true });
console.log("\n通过 " + pass + " / 失败 " + fail);
if (fail) process.exitCode = 1;
