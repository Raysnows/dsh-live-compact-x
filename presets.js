/**
 * 自定义档：一套旋钮值的命名快照，带生效范围。
 *
 * 三种范围，优先级从高到低：
 *  - 本会话   session:<sid>      只在这一条会话里盖住别的层；
 *  - 本工作区 workspace:<workspaceKey> 这个工作区里的所有会话；
 *  - 全部会话 all                所有会话。
 *
 * 引擎每回合读一次（带 mtime 缓存），面板桥和引擎读的是同一份文件。
 * 文件默认 ~/.dsh/spine-presets.json；写坏了按「没有档」处理，不装死。
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { isWritableKey } from "./settings.js";

const MAX_ITEMS = 20;
const MAX_NAME = 24;
const MAX_SID = 200;
const MAX_WS = 300;
const MAX_VALUE = 1e7;
const WORKSPACE_TTL_MS = 30000;

export const PRESET_SCOPES = Object.freeze(["session", "workspace", "all"]);

export function presetsFilePath() {
  return process.env.SPINE_PRESETS_FILE
    || join(process.env.DSH_HOME || join(homedir(), ".dsh"), "spine-presets.json");
}

export function sessionsRoot() {
  return process.env.SPINE_SESSIONS_DIR
    || join(process.env.DSH_HOME || join(homedir(), ".dsh"), "sessions");
}

const cleanId = (value) => (typeof value === "string" ? value.trim() : "");

/**
 * 会话 → 工作区目录名。宿主把工作区路径编码成 sessions 下的一级目录
 * （--D-deepseek-workspaces-work-- 这种），会话目录就在它下面。
 * 找不到就返回空串：工作区档在这一条会话上不生效，但不影响别的范围。
 */
const workspaceCache = new Map();
export function workspaceKeyForSession(sid) {
  const key = cleanId(sid);
  if (!key) return "";
  const now = Date.now();
  const cached = workspaceCache.get(key);
  if (cached && now - cached.at < WORKSPACE_TTL_MS) return cached.value;
  // 宿主有时把 id 记成 "session-<uuid>"，目录名两种写法都见过，两边都试。
  const names = new Set([key, "session-" + key]);
  if (key.startsWith("session-")) names.add(key.slice("session-".length));
  let found = "";
  try {
    const base = sessionsRoot();
    for (const entry of readdirSync(base, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      if (entry.name.length > MAX_WS) continue;
      if ([...names].some((name) => existsSync(join(base, entry.name, name)))) {
        found = entry.name;
        break;
      }
    }
  } catch {
    found = "";
  }
  workspaceCache.set(key, { at: now, value: found });
  return found;
}

function sanitizeValues(values, { partial = false } = {}) {
  const out = {};
  if (!values || typeof values !== "object" || Array.isArray(values)) {
    if (partial) return out;
    throw new Error("values 必须是对象");
  }
  for (const [name, raw] of Object.entries(values)) {
    if (!isWritableKey(name)) throw new Error("不认识的设置项：" + String(name));
    const number = Number(raw);
    if (!Number.isFinite(number) || number < 0 || number > MAX_VALUE) {
      throw new Error("设置项 " + name + " 必须是 0 到 " + MAX_VALUE + " 的数字");
    }
    out[name] = name === "keepRounds" ? Math.max(1, Math.round(number)) : number;
  }
  if (!Object.keys(out).length && !partial) throw new Error("这套档没有任何值");
  return out;
}

function sanitizeName(raw) {
  const text = String(raw == null ? "" : raw).replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim();
  const chars = Array.from(text);
  if (!chars.length) throw new Error("档名不能为空");
  if (chars.length > MAX_NAME) throw new Error("档名最多 " + MAX_NAME + " 个字");
  return chars.join("");
}

function newId() {
  return "p-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6);
}

function emptyState() {
  return { version: 1, scopes: {} };
}

function normalizeItem(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const id = cleanId(raw.id);
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!id || !name) return null;
  let values;
  try { values = sanitizeValues(raw.values, { partial: true }); } catch { return null; }
  if (!Object.keys(values).length) return null;
  return {
    id: id.slice(0, 80),
    name: Array.from(name).slice(0, MAX_NAME).join(""),
    values,
    createdAt: Number(raw.createdAt) || Date.now(),
    updatedAt: Number(raw.updatedAt) || Number(raw.createdAt) || Date.now(),
  };
}

function normalizeScopes(raw) {
  const scopes = {};
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  for (const [key, bucket] of Object.entries(source)) {
    if (!key || key.length > MAX_SID + 40) continue;
    if (!(key === "all" || key.startsWith("session:") || key.startsWith("workspace:"))) continue;
    const items = [];
    for (const item of Array.isArray(bucket?.items) ? bucket.items : []) {
      const clean = normalizeItem(item);
      if (!clean) continue;
      if (items.some((known) => known.id === clean.id)) continue;
      items.push(clean);
      if (items.length >= MAX_ITEMS) break;
    }
    const active = cleanId(bucket?.active);
    scopes[key] = { active: items.some((item) => item.id === active) ? active : "", items };
  }
  return scopes;
}

let cache = { file: "", mtimeMs: -1, state: emptyState() };

export function readPresets() {
  try {
    const file = presetsFilePath();
    if (!existsSync(file)) return emptyState();
    const stat = statSync(file);
    if (cache.file === file && cache.mtimeMs === stat.mtimeMs) return cache.state;
    let parsed = null;
    try { parsed = JSON.parse(readFileSync(file, "utf8")); } catch { parsed = null; }
    const state = { version: 1, scopes: normalizeScopes(parsed?.scopes) };
    cache = { file, mtimeMs: stat.mtimeMs, state };
    return state;
  } catch {
    return emptyState();
  }
}

async function writeState(state) {
  const file = presetsFilePath();
  const body = JSON.stringify({ version: 1, scopes: state.scopes }, null, 2) + "\n";
  const temp = file + ".tmp-" + process.pid + "-" + Date.now();
  await writeFile(temp, body, { mode: 0o600 });
  await rename(temp, file);
  try {
    const stat = statSync(file);
    cache = { file, mtimeMs: stat.mtimeMs, state };
  } catch {
    cache = { file: "", mtimeMs: -1, state };
  }
  return state;
}

/** 范围的存储键；工作区没识别出来时 throw，别把档存到一个谁也读不到的地方。 */
function scopeKeyFor(scope, { sid = "", wsKey = "" } = {}) {
  if (scope === "all") return "all";
  if (scope === "session") {
    const key = cleanId(sid);
    if (!key) throw new Error("缺少会话 ID");
    if (key.length > MAX_SID) throw new Error("会话 ID 太长");
    return "session:" + key;
  }
  if (scope === "workspace") {
    const key = cleanId(wsKey) || workspaceKeyForSession(sid);
    if (!key) throw new Error("当前工作区未识别，工作区档暂时存不了");
    if (key.length > MAX_WS) throw new Error("工作区标识太长");
    return "workspace:" + key;
  }
  throw new Error("未知范围：只支持 session / workspace / all");
}

/**
 * 新建或更新一个档。给了 id 就是改它（名字、值都换）。
 * @param {{scope:string, sid?:string, wsKey?:string, id?:string, name?:string, values?:object}} input
 */
export async function savePreset(input = {}) {
  const scope = PRESET_SCOPES.includes(input.scope) ? input.scope : "";
  if (!scope) throw new Error("未知范围：只支持 session / workspace / all");
  const key = scopeKeyFor(scope, input);
  const state = readPresets();
  const bucket = state.scopes[key] || { active: "", items: [] };
  const items = [...bucket.items];
  const id = cleanId(input.id);
  const name = sanitizeName(input.name);
  const values = sanitizeValues(input.values);
  const now = Date.now();
  if (id) {
    const index = items.findIndex((item) => item.id === id);
    if (index < 0) throw new Error("这个档不存在");
    items[index] = { ...items[index], name, values, updatedAt: now };
    state.scopes[key] = { active: bucket.active, items };
  } else {
    if (items.length >= MAX_ITEMS) throw new Error("这个范围最多存 " + MAX_ITEMS + " 个档");
    const item = { id: newId(), name, values, createdAt: now, updatedAt: now };
    items.push(item);
    state.scopes[key] = { active: bucket.active || item.id, items };
  }
  await writeState(state);
  const savedId = id || (state.scopes[key].items[state.scopes[key].items.length - 1] || {}).id || "";
  return { scope, key, id: savedId, presets: presetsSnapshot(input.sid, input.wsKey) };
}

/** 套用：把这个档设成该范围的当前档。传空 id 等于取消套用。 */
export async function applyPreset(input = {}) {
  const scope = PRESET_SCOPES.includes(input.scope) ? input.scope : "";
  if (!scope) throw new Error("未知范围：只支持 session / workspace / all");
  const key = scopeKeyFor(scope, input);
  const state = readPresets();
  const bucket = state.scopes[key];
  const id = cleanId(input.id);
  if (!id) {
    state.scopes[key] = { active: "", items: bucket?.items || [] };
  } else {
    if (!bucket || !bucket.items.some((item) => item.id === id)) throw new Error("这个档不存在");
    state.scopes[key] = { active: id, items: bucket.items };
  }
  await writeState(state);
  return presetsSnapshot(input.sid, input.wsKey);
}

export async function deletePreset(input = {}) {
  const scope = PRESET_SCOPES.includes(input.scope) ? input.scope : "";
  if (!scope) throw new Error("未知范围：只支持 session / workspace / all");
  const key = scopeKeyFor(scope, input);
  const state = readPresets();
  const bucket = state.scopes[key];
  const id = cleanId(input.id);
  if (!bucket || !bucket.items.some((item) => item.id === id)) throw new Error("这个档不存在");
  const items = bucket.items.filter((item) => item.id !== id);
  state.scopes[key] = { active: bucket.active === id ? "" : bucket.active, items };
  await writeState(state);
  return presetsSnapshot(input.sid, input.wsKey);
}

function activeIn(state, key, wantScope) {
  const bucket = state.scopes[key];
  if (!bucket || !bucket.active) return null;
  const item = bucket.items.find((entry) => entry.id === bucket.active);
  if (!item) return null;
  return { scope: wantScope, id: item.id, name: item.name, values: item.values };
}

/** 这条会话现在该用哪套值：会话 > 工作区 > 全部。没有就是空对象。 */
export function presetLayerFor(sid) {
  try {
    const key = cleanId(sid);
    const state = readPresets();
    const wsKey = key ? workspaceKeyForSession(key) : "";
    const layers = [];
    const all = activeIn(state, "all", "all");
    if (all) layers.push(all);
    const workspace = wsKey ? activeIn(state, "workspace:" + wsKey, "workspace") : null;
    if (workspace) layers.push(workspace);
    const session = key ? activeIn(state, "session:" + key, "session") : null;
    if (session) layers.push(session);
    if (!layers.length) return {};
    return Object.assign({}, ...layers.map((layer) => layer.values));
  } catch {
    return {};
  }
}

/** 桥/面板要的整份视图：三个范围各有几个档、哪个在生效。 */
export function presetsSnapshot(sid, givenWorkspaceKey) {
  const state = readPresets();
  const key = cleanId(sid);
  const wsKey = cleanId(givenWorkspaceKey) || (key ? workspaceKeyForSession(key) : "");
  const bucket = (name) => {
    const entry = state.scopes[name] || { active: "", items: [] };
    return { active: entry.active, items: entry.items.map((item) => ({ ...item })) };
  };
  const session = key ? bucket("session:" + key) : { active: "", items: [] };
  const workspace = wsKey ? bucket("workspace:" + wsKey) : { active: "", items: [] };
  const all = bucket("all");
  const layer = activeIn(state, "session:" + key, "session")
    || activeIn(state, "workspace:" + wsKey, "workspace")
    || activeIn(state, "all", "all");
  return {
    file: presetsFilePath(),
    workspaceKey: wsKey,
    workspaceKnown: Boolean(wsKey),
    scopes: { session, workspace, all },
    layer: layer ? { scope: layer.scope, id: layer.id, name: layer.name } : null,
  };
}

/** 只给桥用：保存时要知道现在该写进哪个档（最高优先级的那个）。 */
export function activePresetFor(sid) {
  try {
    const snapshot = presetsSnapshot(sid);
    if (!snapshot.layer) return null;
    const bucket = snapshot.scopes[snapshot.layer.scope];
    const item = bucket.items.find((entry) => entry.id === snapshot.layer.id);
    return item ? { ...item, scope: snapshot.layer.scope, key: snapshot.layer.scope } : null;
  } catch {
    return null;
  }
}
