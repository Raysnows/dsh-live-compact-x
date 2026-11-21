/**
 * 追加式索引：每条工具结果一行，只记元数据，不存正文。
 * 行格式：{"i":id,"s":seq,"f":session,"h":sha16,"b":bytes}
 * toolCallId 只在会话内唯一，所以 id 的键必须带 session。
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";

export class IndexStore {
  constructor(file) {
    this.file = file;
    mkdirSync(dirname(file), { recursive: true });
    this.byId = new Map();
    this.bySeq = new Map();
  }

  static key(session, seq) { return session + ":" + seq; }
  static idKey(session, id) { return session + "#" + id; }

  append(rec) {
    appendFileSync(this.file, JSON.stringify({ i: rec.id || "", s: rec.seq, f: rec.session, h: rec.sha, b: rec.bytes }) + "\n");
    this.remember(rec);
  }

  remember(rec) {
    if (rec.id) this.byId.set(IndexStore.idKey(rec.session, rec.id), rec);
    this.bySeq.set(IndexStore.key(rec.session, rec.seq), rec);
  }

  load() {
    if (!existsSync(this.file)) return this;
    for (const line of readFileSync(this.file, "utf8").split("\n")) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }
      this.remember({ id: o.i, seq: o.s, session: o.f, sha: o.h, bytes: o.b });
    }
    return this;
  }

  lookup({ session, id, seq }) {
    // seq 是位置，权威；同会话可能复用同一个 toolCallId（上游 issue #2），
    // 只按 id 查会拿到别的轮次那条。
    if (Number.isInteger(seq)) {
      const bySeq = this.bySeq.get(IndexStore.key(session, seq));
      if (bySeq) return bySeq;
    }
    if (id) return this.byId.get(IndexStore.idKey(session, id)) || null;
    return null;
  }
}
