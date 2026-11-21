
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { LogReader } from "file:///D:/deepseek-workspaces/work/plugins/dsh-live-compact-x/v2/log-reader.js";
import { IndexStore } from "file:///D:/deepseek-workspaces/work/plugins/dsh-live-compact-x/v2/index-store.js";
import { FallbackStore, PRUNE_MARKER } from "file:///D:/deepseek-workspaces/work/plugins/dsh-live-compact-x/v2/fallback-store.js";
import { recall, sha16 } from "file:///D:/deepseek-workspaces/work/plugins/dsh-live-compact-x/v2/recall.js";

const ROOT = process.argv[2], WORK = process.argv[3];
const MAXS = Number(process.argv[4] || 24);
const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);

function walk(d, out = []) { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, e.name);
  if (e.isDirectory()) walk(p, out); else if (e.name.endsWith(".jsonl.zstd")) out.push(p); } return out; }
function textOf(o) { const c = o?.data?.message?.content ?? o?.data?.content;
  if (typeof c === "string") return c; if (!Array.isArray(c)) return "";
  return c.filter((x) => x && (x.type === undefined || ["text","input_text","output_text"].includes(x.type))).map((x) => x.text || "").join("\n"); }

fs.rmSync(WORK, { recursive: true, force: true });
const index = new IndexStore(path.join(WORK, "index.jsonl"));
const fallback = new FallbackStore(path.join(WORK, "fallback"));
const reader = new LogReader({ cacheSize: 256 });
const resolve = (session) => path.join(ROOT, session, "session.v4.jsonl.zstd");

const files = walk(ROOT).map((p) => ({ p, size: fs.statSync(p).size })).sort((a, b) => b.size - a.size).slice(0, MAXS);
const all = [];
const t0 = Date.now();
for (const f of files) {
  const session = path.relative(ROOT, path.dirname(f.p));
  const buf = fs.readFileSync(f.p);
  const marks = []; let i = buf.indexOf(MAGIC, 0);
  while (i !== -1) { marks.push(i); i = buf.indexOf(MAGIC, i + 1); }
  for (let k = 0; k < marks.length; k++) {
    const s = marks[k], e = marks[k + 1] ?? buf.length;
    let t = ""; try { t = zlib.zstdDecompressSync(buf.subarray(s, e)).toString("utf8"); } catch { continue; }
    for (const line of t.split("\n")) {
      if (!line.startsWith('{"type":"tool/result"')) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      const text = textOf(o); if (!text) continue;
      const sha = sha16(text);
      index.append({ id: o?.data?.message?.toolCallId || "", seq: o.seq, session, sha, bytes: Buffer.byteLength(text) });
      all.push({ session, seq: o.seq, id: o?.data?.message?.toolCallId || "", sha, text, pruned: text.includes(PRUNE_MARKER), bytes: Buffer.byteLength(text) });
    }
  }
}
const buildMs = Date.now() - t0;
// 预热：建 seq 索引（一次性成本，不计入召回延迟）
for (const f of files) { try { reader.buildSeqIndex(f.p); } catch {} }

// 模拟 2.2% 被修剪：抓原文进兜底，并标记为“日志已不可读”
const candidates = all.filter((x) => !x.pruned);
const prunedShas = new Set();
for (let i = 0; i < Math.floor(candidates.length * 0.022); i++) {
  const x = candidates[(i * 97) % candidates.length];
  fallback.put(x.text); prunedShas.add(x.sha);
}
const fb = fallback.size();
const assumePruned = (rec) => prunedShas.has(rec.sha);

let ok = 0, bad = 0; const latLog = [], latFb = []; let fromLog = 0, fromFb = 0; const badSamples = [];
// 真实已被修剪的结果，原文已不在日志里，本轮不纳入召回样本（生产由 prune-hook 事前抓取）
const sampleable = all.filter((x) => !x.pruned);
const SAMPLE = Math.min(3000, sampleable.length);
for (let i = 0; i < SAMPLE; i++) {
  const x = sampleable[(i * 131) % sampleable.length];
  const r = recall({ index, reader, fallback, resolve, session: x.session, seq: x.seq, id: x.id || undefined, assumePruned });
  if (r.ok && r.text === x.text) { ok++; if (r.source === "log") { fromLog++; latLog.push(r.ms); } else { fromFb++; latFb.push(r.ms); } }
  else { bad++; if (badSamples.length < 5) badSamples.push({ session: x.session, seq: x.seq, id: x.id, source: r.source, got: (r.text || '').length, want: x.text.length }); }
}
const pct = (a, p) => a.length ? a.slice().sort((x, y) => x - y)[Math.floor(a.length * p)] : 0;
const avg = (a) => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const idxSize = fs.statSync(index.file).size;

console.log(JSON.stringify({
  sessions: files.length, results: all.length, rawMB: +(all.reduce((a, b) => a + b.bytes, 0) / 1e6).toFixed(2),
  index: { MB: +(idxSize / 1e6).toFixed(2), perLine: +(idxSize / all.length).toFixed(0), pctOfRaw: +(100 * idxSize / all.reduce((a, b) => a + b.bytes, 0)).toFixed(1) },
  fallback: { files: fb.files, MB: +(fb.bytes / 1e6).toFixed(2), pct: +(100 * fb.files / all.length).toFixed(1) },
  recall: { sample: SAMPLE, ok, bad, successPct: +(100 * ok / SAMPLE).toFixed(1), fromLog, fromFb,
    badSamples,
    logP50: +pct(latLog, 0.5).toFixed(3), logP95: +pct(latLog, 0.95).toFixed(3), logAvg: +avg(latLog).toFixed(3),
    fbP50: +pct(latFb, 0.5).toFixed(3), fbAvg: +avg(latFb).toFixed(3) },
}, null, 1));
