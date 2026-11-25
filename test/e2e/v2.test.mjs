import { appendFileSync, copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { makeTemp } from "../fixtures/temp.mjs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { zstdCompressSync } from "node:zlib";
import { LogReader } from "../../src/recall/log-reader.js";
import { IndexStore } from "../../src/recall/index-store.js";
import { FallbackStore, PRUNE_MARKER } from "../../src/recall/fallback-store.js";
import { installPruneHook } from "../../src/recall/prune-hook.js";
import { recall, sha16 } from "../../src/recall/recall.js";

let pass = 0, fail = 0;
const ok = (c, n, extra = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + " " + extra); } };
const work = makeTemp("v2rev-");
// 夹具：优先用调用方给的真实会话日志；没给就自己造一份合成日志。
// 这样干净 clone / CI 也能跑，不依赖某台机器的 ~/.dsh。
const givenSession = process.argv[2];
const SESSION = (() => {
  if (givenSession && existsSync(givenSession)) return givenSession;
  const file = join(work, "fixture.v4.jsonl.zstd");
  const frames = [];
  for (let seq = 1; seq <= 60; seq += 1) {
    const line = JSON.stringify({
      type: seq % 3 === 0 ? "tool/result" : "user/message",
      seq,
      data: { message: { toolCallId: "synthetic-" + seq, content: [{ type: "text", text: "合成正文 " + seq }] }, source: { kind: "user" } },
    });
    frames.push(zstdCompressSync(Buffer.from(line + "\n", "utf8")));
  }
  writeFileSync(file, Buffer.concat(frames));
  return file;
})();
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function frameFor(seq, text) {
  const line = JSON.stringify({ type: "tool/result", seq, data: { message: { toolCallId: "synthetic-" + seq, content: [{ type: "text", text }] } } });
  return Buffer.concat([zstdCompressSync(Buffer.from(""), {}), zstdCompressSync(Buffer.from(line + "\n", "utf8"))]);
}

console.log("1. LogReader 基础");
let reader = new LogReader();
let firstSeq = null, firstText = null;
{
  const e = reader.refresh(SESSION);
  ok(e.seqToFrame.size > 50, "建了 seq 索引（" + e.seqToFrame.size + " 条）");
  const seqs = [...e.seqToFrame.keys()].sort((a, b) => a - b);
  firstSeq = seqs[Math.floor(seqs.length / 2)];
  firstText = reader.readBySeq(SESSION, firstSeq);
  ok(typeof firstText === "string", "读回 seq=" + firstSeq);
  ok(reader.readBySeq(SESSION, firstSeq) === firstText, "缓存命中一致");
  ok(reader.readBySeq(SESSION, 999999999) === null, "不存在的 seq 返回 null");
}

console.log("2. 增量：追加一个帧后只重解尾部");
{
  const copy = join(work, "s.v4.jsonl.zstd");
  copyFileSync(SESSION, copy);
  const r1 = new LogReader();
  const before = r1.refresh(copy).seqToFrame.size;
  appendFileSync(copy, frameFor(99001, "增量测试正文 abcdef"));
  const e2 = r1.refresh(copy);
  ok(r1.readBySeq(copy, 99001) === "增量测试正文 abcdef", "新 seq 立即可读");
  ok(e2.seqToFrame.size === before + 1, "只新增 1 条索引（" + before + " -> " + e2.seqToFrame.size + "）");
  const mid = [...e2.seqToFrame.keys()].find((s) => s !== 99001);
  ok(typeof r1.readBySeq(copy, mid) === "string", "旧 seq 仍可读");
  appendFileSync(copy, frameFor(99002, "第二条增量"));
  ok(r1.readBySeq(copy, 99002) === "第二条增量", "连续追加也能读到");
}

console.log("3. 尾部截断/损坏不致命");
{
  const copy = join(work, "broken.jsonl.zstd");
  copyFileSync(SESSION, copy);
  appendFileSync(copy, Buffer.concat([MAGIC, Buffer.from([1, 2, 3, 4, 5])]));
  const r = new LogReader();
  let threw = false;
  try { r.refresh(copy); } catch { threw = true; }
  ok(!threw, "损坏帧不抛异常");
  ok(typeof r.readBySeq(copy, firstSeq) === "string", "损坏帧之前的 seq 仍可读");
}

console.log("4. IndexStore");
{
  const f = join(work, "index.jsonl");
  const s = new IndexStore(f);
  s.append({ id: "call_1", seq: 42, session: "s1", sha: "abc123", bytes: 100 });
  s.append({ id: "call_1", seq: 43, session: "s1", sha: "def456", bytes: 200 });
  ok(s.lookup({ session: "s1", id: "call_1", seq: 43 })?.sha === "def456", "同 id 不同 seq：seq 优先");
  ok(s.lookup({ session: "s1", id: "call_1" })?.seq === 43, "只给 id：取最后一条");
  appendFileSync(f, "{坏行\n");
  const s2 = new IndexStore(f).load();
  ok(s2.lookup({ session: "s1", seq: 42 })?.sha === "abc123", "坏行被跳过，其余可加载");
}

console.log("5. FallbackStore / PruneHook");
{
  const store = new FallbackStore(join(work, "fb"));
  const text = "x".repeat(20000);
  const r1 = store.put(text);
  ok(r1.stored && r1.packed < r1.bytes, "压缩存储（" + r1.bytes + " -> " + r1.packed + "）");
  ok(store.get(r1.sha) === text, "取回原文");
  ok(store.put(text).stored === false, "幂等");
  let captured = 0;
  const pruner = { pruneContent: (b) => (b.reduce((a, x) => a + x.text.length, 0) > 100 ? [{ type: "text", text: "P" }] : null) };
  const undo = installPruneHook(pruner, store, { onCapture: () => captured++ });
  pruner.pruneContent([{ type: "text", text: "y".repeat(500) }]);
  pruner.pruneContent([{ type: "text", text: "short" }]);
  ok(captured === 1, "只有被修剪时抓");
  undo();
  pruner.pruneContent([{ type: "text", text: "y".repeat(500) }]);
  ok(captured === 1, "卸载后不再抓");
}

console.log("6. recall 四条路径");
{
  const reader2 = new LogReader();
  const index = new IndexStore(join(work, "idx2.jsonl"));
  const fb = new FallbackStore(join(work, "fb2"));
  const text = "回读 payload " + "z".repeat(3000);
  const sha = sha16(text);
  const session = "sX";
  index.append({ id: "c9", seq: 7, session, sha, bytes: Buffer.byteLength(text) });
  const resolve = () => join(work, "missing.jsonl");

  ok(recall({ index, reader: reader2, fallback: fb, resolve, session, seq: 7, id: "c9" }).source === "missing", "日志缺失 -> missing");
  fb.put(text);
  const okPath = recall({ index, reader: reader2, fallback: fb, resolve, session, seq: 7, id: "c9" });
  ok(okPath.ok && okPath.source === "fallback", "兜底救回");

  const bad = new FallbackStore(join(work, "fb3"));
  writeFileSync(join(bad.dir, sha + ".zst"), zstdCompressSync(Buffer.from("别的内容")));
  ok(recall({ index, reader: reader2, fallback: bad, resolve, session, seq: 7, id: "c9" }).source === "sha-mismatch", "内容不符拒绝返回");

  const idx4 = new IndexStore(join(work, "idx4.jsonl"));
  idx4.append({ id: "c10", seq: 8, session, sha, bytes: Buffer.byteLength(text) + 1 });
  fb.put(text);
  ok(recall({ index: idx4, reader: reader2, fallback: fb, resolve, session, seq: 8, id: "c10" }).source === "bytes-mismatch", "字节数不符拒绝返回");

  ok(recall({ index, reader: reader2, fallback: fb, resolve, session, id: "nope" }).source === "missing-index", "索引没有 -> missing-index");
}

console.log("N. 全事件索引：user / assistant 也能按 seq 回读");
{
  const dir = makeTemp("spine-lr-");
  const file = join(dir, "session.v4.jsonl.zstd");
  const lines = [
    JSON.stringify({ type: "user/message", seq: 7, data: { message: { role: "user", content: [{ type: "text", text: "用户原话" }] } } }),
    JSON.stringify({ type: "assistant/message", seq: 8, data: { message: { role: "assistant", content: [{ type: "reasoning", text: "内部思考" }, { type: "text", text: "助手结论" }] } } }),
    JSON.stringify({ type: "tool/result", seq: 9, data: { message: { content: [{ type: "text", text: "工具输出" }] } } }),
  ].join("\n");
  writeFileSync(file, zstdCompressSync(Buffer.from(lines)));
  const reader = new LogReader();
  const e = reader.refresh(file);
  ok(e.seqToFrame.size === 3, "三种事件都进索引：" + e.seqToFrame.size);
  ok(reader.readBySeq(file, 7) === "用户原话", "user 按 seq 回读");
  ok(reader.readBySeq(file, 8) === "助手结论", "assistant 只取正文不含 reasoning：" + JSON.stringify(reader.readBySeq(file, 8)));
  ok(reader.readBySeq(file, 9) === "工具输出", "tool 照旧");
  rmSync(dir, { recursive: true, force: true });
}

rmSync(work, { recursive: true, force: true });
console.log("\n通过 " + pass + " / 失败 " + fail);
if (fail) process.exitCode = 1;
