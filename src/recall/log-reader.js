/**
 * 按 seq 从会话日志读原文（V2 事件存储的回读端）。
 *
 * 日志是 zstd 多帧拼接（session.v4.jsonl.zstd）。三个要点：
 * 1. 切帧 + 建「seq → 帧号」，让召回从 O(文件) 降到 O(1)；
 * 2. **增量重建**：会话在跑的时候日志每轮都变，不能每次全量重解。
 *    只要旧前缀的帧起点没变，就只重解「最后一个帧」（可能正在写）+ 新增帧；
 * 3. 解出的正文进 LRU；文件变了只清这个文件的缓存。
 */
import { readFileSync, statSync } from "node:fs";
import { zstdDecompressSync } from "node:zlib";

const MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd]);
// 任何事件都进索引：卡片上的 seq 指向的不只是 tool/result，还有 user/assistant 消息。
// 只认 tool/result 时，8,425 帧里只有 2,052 个可寻址，其余 seq 等于空指针——
// 这也是上游必须给每刀写一份 span 全文副本的原因。放宽后卡片可以只靠日志回读。
const SEQ_RE = /^\{"type":"[^"]+","seq":(\d+)/;

function scanFrames(buf) {
  const frames = [];
  let i = buf.indexOf(MAGIC, 0);
  while (i !== -1) { frames.push(i); i = buf.indexOf(MAGIC, i + 1); }
  return frames;
}

function decode(buf, offsets, k) {
  const s = offsets[k], e = offsets[k + 1] ?? buf.length;
  try { return zstdDecompressSync(buf.subarray(s, e)).toString("utf8"); } catch { return null; }
}

/** 从一个事件里取出对卡片有用的正文：工具结果、助手正文（不含 reasoning）、用户原话。 */
export function eventBody(event) {
  const data = event?.data ?? {};
  const message = data.message ?? {};
  const content = message.content ?? data.content;
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) {
    if (typeof data.text === "string") return data.text;
    if (typeof message.text === "string") return message.text;
    return "";
  }
  return content
    .filter((x) => x && typeof x.text === "string")
    .filter((x) => x.type === undefined || ["text", "input_text", "output_text"].includes(x.type))
    .map((x) => x.text)
    .join("\n");
}

export class LogReader {
  constructor({ cacheSize = 128, maxFrameBytes = 8 * 1024 * 1024 } = {}) {
    this.cacheSize = cacheSize;
    this.maxFrameBytes = maxFrameBytes;
    this.files = new Map();
    this.cache = new Map(); // "file#frame" -> text
  }

  /** 读取文件并（增量）更新帧表与 seq 索引。 */
  refresh(file) {
    const st = statSync(file);
    const cur = this.files.get(file);
    if (cur && cur.size === st.size && cur.mtimeMs === st.mtimeMs) return cur;

    const buf = readFileSync(file);
    const frames = scanFrames(buf);
    const reusable = cur && buf.length >= cur.size && frames.length >= cur.frames.length &&
      cur.frames.every((off, i) => frames[i] === off);

    const entry = cur && reusable
      ? { size: st.size, mtimeMs: st.mtimeMs, buf, frames, frameSeqs: cur.frameSeqs, seqToFrame: cur.seqToFrame, indexedTo: cur.indexedTo }
      : { size: st.size, mtimeMs: st.mtimeMs, buf, frames, frameSeqs: new Map(), seqToFrame: new Map(), indexedTo: 0 };

    // 最后一个帧可能还在追加，旧索引里的条目一律重算
    const from = entry === cur ? Math.max(0, Math.min(entry.indexedTo, frames.length - 1)) : 0;
    if (from === 0) { entry.frameSeqs = new Map(); entry.seqToFrame = new Map(); }
    else {
      for (let k = from; k < frames.length; k++) {
        for (const seq of entry.frameSeqs.get(k) || []) entry.seqToFrame.delete(seq);
        entry.frameSeqs.delete(k);
      }
    }

    for (let k = from; k < frames.length; k++) {
      const text = decode(buf, frames, k);
      if (text === null) continue;                       // 截断/损坏的帧跳过，下次变了再试
      const seqs = [];
      for (const line of text.split("\n")) {
        const m = SEQ_RE.exec(line);
        if (m) { const seq = Number(m[1]); seqs.push(seq); entry.seqToFrame.set(seq, k); }
      }
      entry.frameSeqs.set(k, seqs);
    }
    entry.indexedTo = frames.length;

    // 只清这个文件的解码缓存
    for (const key of [...this.cache.keys()]) if (key.startsWith(file + "#")) this.cache.delete(key);
    this.files.set(file, entry);
    return entry;
  }

  decodeFrame(file, k) {
    const key = file + "#" + k;
    const hit = this.cache.get(key);
    if (hit !== undefined) { this.cache.delete(key); this.cache.set(key, hit); return hit; }
    const e = this.refresh(file);
    const s = e.frames[k], size = (e.frames[k + 1] ?? e.buf.length) - s;
    if (size > this.maxFrameBytes) return null;           // 单帧过大，拒绝全解，交给调用方降级
    const text = decode(e.buf, e.frames, k);
    if (text === null) return null;
    if (this.cache.size >= this.cacheSize) this.cache.delete(this.cache.keys().next().value);
    this.cache.set(key, text);
    return text;
  }

  /** 返回 seq 对应事件的正文；不存在返回 null。 */
  readBySeq(file, seq) {
    const e = this.refresh(file);
    const k = e.seqToFrame.get(seq);
    if (k === undefined) return null;
    const text = this.decodeFrame(file, k);
    if (text === null) return null;
    for (const line of text.split("\n")) {
      const m = SEQ_RE.exec(line);
      if (!m || Number(m[1]) !== seq) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      return eventBody(o);
    }
    return null;
  }

  stats() {
    const out = [];
    for (const [file, e] of this.files) out.push({ file, frames: e.frames.length, seqs: e.seqToFrame.size, bytes: e.size });
    return out;
  }
}
