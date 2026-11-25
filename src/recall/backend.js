/**
 * V2 存储后端：索引 + 日志回读 + 修剪兜底。零副本。
 *
 * 与 raw.js 的契约：
 *   capture({ sessionId, toolCallId, seq, text, label }) -> record
 *   read({ sessionId, toolCallId, seq })                 -> record
 *   verify(record)                                       -> { ok, text, ... }
 * record.path 是伪路径 "log:<sessionId>#<seq>"，只用于卡片可读文案，不参与 IO。
 */
import { existsSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { IndexStore } from "./index-store.js";
import { LogReader } from "./log-reader.js";
import { FallbackStore, PRUNE_MARKER } from "./fallback-store.js";
import { recall, sha16 } from "./recall.js";

export class V2Backend {
  constructor({ rootDir, sessionsRoot }) {
    this.rootDir = rootDir;
    this.sessionsRoot = sessionsRoot;
    this.index = new IndexStore(join(rootDir, "index.jsonl")).load();
    this.fallback = new FallbackStore(join(rootDir, "fallback"));
    this.reader = new LogReader();
    this.logs = new Map(); // sessionId -> log path | null
  }

  /** session-<uuid> 目录名就是会话 id；找不到返回 null。 */
  logPath(sessionId) {
    if (!sessionId) return null;
    if (this.logs.has(sessionId)) return this.logs.get(sessionId);
    let found = null;
    const names = [sessionId];
    if (!sessionId.startsWith("session-")) names.push("session-" + sessionId);
    else names.push(sessionId.slice("session-".length));
    try {
      const slugs = readdirSync(this.sessionsRoot, { withFileTypes: true }).filter((d) => d.isDirectory());
      for (const name of names) {
        for (const slug of slugs) {
          const candidate = join(this.sessionsRoot, slug.name, name, "session.v4.jsonl.zstd");
          if (existsSync(candidate)) { found = candidate; break; }
        }
        if (found) break;
      }
    } catch {}
    this.logs.set(sessionId, found);
    return found;
  }

  publicPath(sessionId, seq) { return "log:" + sessionId + "#" + seq; }

  capture({ sessionId, toolCallId, seq, text, label }) {
    const body = String(text ?? "");
    if (!toolCallId) return { ok: false, reason: "missing-id", toolCallId: "" };
    if (body.includes(PRUNE_MARKER)) return { ok: false, reason: "already-pruned", toolCallId, unrecoverable: true };
    if (!Number.isInteger(seq)) return { ok: false, reason: "missing-seq", toolCallId, retryable: false };
    // 日志不在就别写索引，否则召回必然失败
    if (!this.logPath(sessionId)) return { ok: false, reason: "missing-session-log", toolCallId };

    const bytes = Buffer.byteLength(body);
    const sha16v = sha16(body);
    this.index.append({ id: toolCallId, seq, session: sessionId, sha: sha16v, bytes });
    return { ok: true, existed: false, kind: "v2", path: this.publicPath(sessionId, seq),
      bytes, sha256: sha16v, sha16: sha16v, toolCallId, label: label || "", sessionId, seq };
  }

  read({ sessionId, toolCallId, seq }) {
    const rec = this.index.lookup({ session: sessionId, id: toolCallId, seq });
    if (!rec) return { ok: false, reason: "missing-index", toolCallId };
    return { ok: true, existed: true, kind: "v2", path: this.publicPath(rec.session, rec.seq),
      bytes: rec.bytes, sha256: rec.sha, sha16: rec.sha, toolCallId, label: "",
      sessionId: rec.session, seq: rec.seq };
  }

  verify(record) {
    const id = record?.toolCallId || "";
    if (!record?.kind || record.kind !== "v2" || !id) return { ok: false, toolCallId: id };
    const log = this.logPath(record.sessionId);
    const r = recall({
      index: this.index,
      reader: this.reader,
      fallback: this.fallback,
      resolve: () => log || "",
      session: record.sessionId,
      seq: record.seq,
      id,
      assumePruned: (rec) => rec.sha !== record.sha16,
    });
    if (!r.ok) return { ok: false, toolCallId: id, reason: r.source };
    return { ok: true, text: r.text, toolCallId: id, path: record.path,
      sha256: record.sha16, bytes: Buffer.byteLength(r.text), label: record.label || "" };
  }

  stats() {
    return { indexFile: this.index.file, sessionsRoot: this.sessionsRoot, cachedLogs: this.logs.size };
  }
}
