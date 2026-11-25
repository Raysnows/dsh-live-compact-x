/**
 * 存储后端选择：默认 v2；设 SPINE_STORE=v1 或 v2 强制。
 * 取不到目录时退回 v1，保证插件永远能跑。
 */
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { V2Backend } from "./backend.js";

let cached = null;

export function v2Enabled() {
  const mode = String(process.env.SPINE_STORE || "v2").toLowerCase();
  return mode !== "v1";
}

export function getV2({ shadowRoot, sessionsRoot }) {
  if (cached) return cached;
  cached = new V2Backend({ rootDir: dirname(shadowRoot), sessionsRoot });
  return cached;
}

export function resetV2() { cached = null; }

export function defaultV2() {
  const home = process.env.DSH_HOME || join(homedir(), ".dsh");
  const shadowRoot = process.env.SPINE_SHADOW_DIR || join(home, "compaction-spine", "shadow");
  const sessionsRoot = process.env.SPINE_SESSIONS_DIR || join(home, "sessions");
  return getV2({ shadowRoot, sessionsRoot });
}
