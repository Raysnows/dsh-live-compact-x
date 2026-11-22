/**
 * 总开关：这个功能到底要不要干活。
 *
 * 两个层级：
 *  - 全部会话：`enabled`，一关就全站停手；
 *  - 单个会话：把 session id 放进 `disabled`，只停这一条。
 * 文件默认是 `~/.dsh/spine-switch.json`，面板保存后下一回合就生效，不用重启。
 * 引擎每回合读一次（带 mtime 缓存），写坏了就按「开着」处理，不装死。
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const MAX_DISABLED = 200;
const MAX_SID = 200;

export function switchFilePath() {
  return process.env.SPINE_SWITCH_FILE
    || join(process.env.DSH_HOME || join(homedir(), ".dsh"), "spine-switch.json");
}

function normalize(raw) {
  const value = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const list = Array.isArray(value.disabled) ? value.disabled : [];
  const disabled = [];
  for (const item of list) {
    const sid = typeof item === "string" ? item.trim() : "";
    if (!sid || sid.length > MAX_SID || disabled.includes(sid)) continue;
    disabled.push(sid);
    if (disabled.length >= MAX_DISABLED) break;
  }
  return { enabled: value.enabled !== false, disabled };
}

let cache = { file: "", mtimeMs: -1, value: { enabled: true, disabled: [] } };

function readFromDisk(file) {
  if (!existsSync(file)) return { enabled: true, disabled: [] };
  const stat = statSync(file);
  const mtimeMs = stat.mtimeMs;
  if (cache.file === file && cache.mtimeMs === mtimeMs) return cache.value;
  let parsed = null;
  try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { parsed = null; }
  const value = normalize(parsed);
  cache = { file, mtimeMs, value };
  return value;
}

/** 当前状态（只读快照）。 */
export function readSwitchState() {
  try {
    return { ...readFromDisk(switchFilePath()) };
  } catch {
    return { enabled: true, disabled: [] };
  }
}

/** 引擎入口的判断：全局关 ⇒ 全停；单会话关 ⇒ 只停这一条。 */
export function compactionEnabled(sid) {
  const state = readSwitchState();
  if (!state.enabled) return false;
  const key = typeof sid === "string" ? sid.trim() : "";
  return !key || !state.disabled.includes(key);
}

async function writeState(next) {
  const file = switchFilePath();
  const body = JSON.stringify({ enabled: next.enabled, disabled: next.disabled }, null, 2) + "\n";
  const tmp = `${file}.tmp-${process.pid}-${Date.now()}`;
  await writeFile(tmp, body, { mode: 0o600 });
  await rename(tmp, file);
  try {
    const stat = statSync(file);
    cache = { file, mtimeMs: stat.mtimeMs, value: next };
  } catch {
    cache = { file: "", mtimeMs: -1, value: next };
  }
  return next;
}

/**
 * 改开关。
 * @param {{scope?: "session"|"all", enabled?: boolean, sid?: string}} input
 */
export async function setSwitchState(input = {}) {
  const scope = input.scope === "all" ? "all" : input.scope === "session" ? "session" : "";
  if (!scope) throw new Error("未知范围：只支持 session / all");
  if (typeof input.enabled !== "boolean") throw new Error("enabled 必须是 true / false");
  const current = readSwitchState();
  const next = { enabled: current.enabled, disabled: [...current.disabled] };
  if (scope === "all") {
    next.enabled = input.enabled;
  } else {
    const sid = typeof input.sid === "string" ? input.sid.trim() : "";
    if (!sid) throw new Error("缺少会话 ID");
    if (sid.length > MAX_SID) throw new Error("会话 ID 太长");
    next.disabled = next.disabled.filter((item) => item !== sid);
    if (!input.enabled) next.disabled.push(sid);
  }
  return writeState(next);
}

/** 面板要的整份状态：全局 + 本条会话。 */
export function switchSnapshot(sid) {
  const state = readSwitchState();
  const key = typeof sid === "string" ? sid.trim() : "";
  return {
    file: switchFilePath(),
    global: state.enabled,
    session: compactionEnabled(key),
    sessionDisabled: Boolean(key) && state.disabled.includes(key),
    disabledCount: state.disabled.length,
  };
}
