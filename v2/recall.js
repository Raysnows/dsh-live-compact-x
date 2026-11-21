/**
 * 统一召回：索引 -> 日志 -> 兜底副本，每一步都校验 sha。
 *
 * 日志里的正文一旦被官方修剪器改写成 marker，就只能走兜底副本；
 * assumePruned 让调用方显式声明这种已知状态（生产里用 marker 检测即可）。
 */
import { createHash } from "node:crypto";

export const MARKER = "[... tool result middle pruned ...]";
export function sha16(text) { return createHash("sha256").update(text).digest("hex").slice(0, 16); }

export function recall({ index, reader, fallback, resolve, session, seq, id, assumePruned }) {
  const rec = index.lookup({ session, id, seq });
  if (!rec) return { ok: false, source: "missing-index", ms: 0 };

  let text = null, source = "log";
  const t0 = process.hrtime.bigint();
  const pruned = typeof assumePruned === "function" ? assumePruned(rec) : false;
  if (!pruned) {
    try { text = reader.readBySeq(resolve(rec.session), rec.seq); } catch { text = null; }
    if (typeof text === "string" && text.includes(MARKER)) { text = null; source = "fallback"; }
  } else { source = "fallback"; }
  if (text === null) {
    text = fallback.get(rec.sha);
    if (text !== null) source = "fallback";
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;

  if (text === null) return { ok: false, source: "missing", ms };
  if (sha16(text) !== rec.sha) return { ok: false, source: "sha-mismatch", ms };
  if (Number.isInteger(rec.bytes) && Buffer.byteLength(text) !== rec.bytes) return { ok: false, source: "bytes-mismatch", ms };
  return { ok: true, source, ms, text };
}
