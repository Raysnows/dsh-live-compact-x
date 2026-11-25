/**
 * 兜底副本：只存「会被官方修剪器改写」的那 2.2%。
 *
 * 修剪器把正文中段换成 [... tool result middle pruned ...] 之后，日志里的原文就没了，
 * 索引再怎么指也指不回来。所以必须在它动手之前抓一份，zstd 压着放。
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { zstdCompressSync, zstdDecompressSync } from "node:zlib";

export const PRUNE_MARKER = "[... tool result middle pruned ...]";

export class FallbackStore {
  constructor(dir) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  static sha(text) { return createHash("sha256").update(text).digest("hex").slice(0, 16); }

  put(text) {
    const sha = FallbackStore.sha(text);
    const f = join(this.dir, sha + ".zst");
    if (!existsSync(f)) {
      const packed = zstdCompressSync(Buffer.from(text, "utf8"));
      writeFileSync(f, packed);
      return { sha, bytes: text.length, packed: packed.length, stored: true };
    }
    return { sha, bytes: text.length, packed: statSync(f).size, stored: false };
  }

  get(sha) {
    const f = join(this.dir, sha + ".zst");
    if (!existsSync(f)) return null;
    try { return zstdDecompressSync(readFileSync(f)).toString("utf8"); } catch { return null; }
  }

  size() {
    let n = 0, b = 0;
    for (const name of readdirSync(this.dir)) { n++; b += statSync(join(this.dir, name)).size; }
    return { files: n, bytes: b };
  }
}
