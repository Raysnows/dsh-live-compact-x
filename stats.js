/**
 * 跨会话刀法统计：只读 shadow 根目录下那份决策日志（spine-decisions.jsonl），
 * 按记录里的 sid 汇总「每把刀切了几刀、切掉多少 token」。
 *
 * 面板的「全部会话」就是这个数——不需要另开通道：它随会话投影的 view 一起
 * 下发，读一次文件、按 mtime+size 判重，1.5 秒内的重复读取走缓存。
 */

import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";

export const DECISIONS_FILE = "spine-decisions.jsonl";
const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
const DEFAULT_TTL_MS = 1500;

const emptyKnife = () => ({ cuts: 0, tokens: 0, saved: 0 });

function emptyAggregate() {
  return {
    generatedAt: 0,
    since: 0,
    sessions: 0,
    // 日志只知道本插件做过什么：小刀、中刀、大刀（请官方摘要接手）。
    // 原生官方压缩不走这里，所以没有 official 这一格。
    knives: { small: emptyKnife(), merge: emptyKnife(), big: emptyKnife() },
    attempts: { cut: 0, cutSkip: 0, mergeSkip: 0, official: 0, failed: 0 },
    // 每个会话第一次有记录的毫秒数：早于它就是插件接管之前的历史压缩。
    firstBySid: {},
    recent: [],
  };
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

/** 一刀记在哪个刀法名下：official-handover 是本插件的大刀，cut 记录看 merge 标记。 */
function knifeKey(record) {
  if (record?.phase === "official-handover") return "big";
  if (record?.merge === true) return "merge";
  return "small";
}

/**
 * 把决策日志文本折成统计。纯函数，测试直接喂文本。
 * @param {string} text JSONL 文本
 */
export function aggregateDecisions(text) {
  const out = emptyAggregate();
  const sessions = new Set();
  const lines = String(text || "").split("\n");
  for (const line of lines) {
    const raw = line.trim();
    if (!raw || raw[0] !== "{") continue;
    let record = null;
    try { record = JSON.parse(raw); } catch { continue; }
    if (!record || typeof record !== "object") continue;
    const sid = String(record.sid ?? record.sessionId ?? "");
    if (sid) sessions.add(sid);
    const ts = Date.parse(String(record.ts || "")) || 0;
    if (ts && (!out.since || ts < out.since)) out.since = ts;
    if (ts && sid && (!out.firstBySid[sid] || ts < out.firstBySid[sid])) out.firstBySid[sid] = ts;
    const phase = String(record.phase || "");
    const result = String(record.result || "");
    if (phase === "cut") {
      if (result === "committed") {
        const key = knifeKey(record);
        const saved = num(record.saved);
        const knife = out.knives[key];
        out.knives[key] = {
          cuts: knife.cuts + 1,
          tokens: knife.tokens + (num(record.tokens) || num(record.before) - num(record.after) || saved),
          saved: knife.saved + saved,
        };
        out.attempts.cut += 1;
        out.recent.push({ t: ts, sid, kind: key, saved, tokens: num(record.tokens) });
      } else {
        out.attempts.failed += 1;
      }
      continue;
    }
    if (phase === "official-handover") {
      if (result === "ran") {
        const before = num(record.before);
        const after = num(record.after);
        const saved = Math.max(0, before - after);
        const knife = out.knives.big;
        out.knives.big = { cuts: knife.cuts + 1, tokens: knife.tokens + before, saved: knife.saved + saved };
        out.attempts.official += 1;
        out.recent.push({ t: ts, sid, kind: "big", saved, tokens: before });
      } else if (result === "failed") {
        out.attempts.failed += 1;
      }
      continue;
    }
    if (phase === "cut-skip") { out.attempts.cutSkip += 1; continue; }
    if (phase === "merge-skip") { out.attempts.mergeSkip += 1; continue; }
  }
  out.sessions = sessions.size;
  out.recent.sort((a, b) => (b.t || 0) - (a.t || 0));
  out.recent = out.recent.slice(0, 24);
  out.generatedAt = Date.now();
  return out;
}

let cachedStats = null;
let cachedKey = "";
let cachedAt = 0;

/**
 * 读一份汇总，按文件大小 + mtime 判重；TTL 内的重复调用直接给缓存。
 * 任何异常都退化成空统计——统计读不出来不该影响面板其它部分。
 * @param {{ dir?: string, ttlMs?: number, maxBytes?: number, now?: number }} options
 */
export function readGlobalStats({ dir, ttlMs = DEFAULT_TTL_MS, maxBytes = DEFAULT_MAX_BYTES, now = Date.now() } = {}) {
  if (!dir) return emptyAggregate();
  const file = join(dir, DECISIONS_FILE);
  let key = "";
  try {
    const info = statSync(file);
    key = file + ":" + info.size + ":" + Math.round(info.mtimeMs);
  } catch {
    return emptyAggregate();
  }
  if (cachedStats && cachedKey === key && now - cachedAt < ttlMs) return cachedStats;
  let text = "";
  try {
    const info = statSync(file);
    const fd = readFileSync(file); // 日志按容量轮换，单份不会太大；整读比偏移读取稳
    text = (info.size > maxBytes ? fd.subarray(fd.length - maxBytes) : fd).toString("utf8");
  } catch {
    return cachedStats || emptyAggregate();
  }
  cachedStats = aggregateDecisions(text);
  cachedKey = key;
  cachedAt = now;
  return cachedStats;
}

/**
 * 会话名归一：日志里是 session-<uuid>，投影里可能只有 <uuid>，
 * 也可能带着工作区前缀（--D-work--/session-<uuid>）。只留最后一段并剥掉前缀。
 */
export function sidKey(sid) {
  const raw = String(sid || "");
  const tail = raw.split(/[\\/]/).pop() || raw;
  return tail.replace(/^session-/, "").replace(/^memory-/, "");
}

/**
 * 这条会话第一次被本插件碰到的毫秒数：早于它的官方压缩是接管前的历史，
 * 不该记成本插件的大刀。
 * @param {ReturnType<typeof readGlobalStats>} aggregate
 * @param {string} sid
 */
export function firstActivityOf(aggregate, sid) {
  const table = aggregate?.firstBySid || {};
  const key = sidKey(sid);
  if (!key) return 0;
  if (Number.isFinite(Number(table[key]))) return Number(table[key]);
  for (const [raw, ts] of Object.entries(table)) {
    const other = sidKey(raw);
    if (other === key) return Number(ts) || 0;
    // 只容忍整段前缀/后缀差：太短的名字不参与模糊匹配，免得撞车。
    if (key.length >= 8 && other.length >= 8 && (other.includes(key) || key.includes(other))) return Number(ts) || 0;
  }
  return 0;
}

/** 测试用：清掉模块级缓存。 */
export function resetStatsCache() {
  cachedStats = null;
  cachedKey = "";
  cachedAt = 0;
}
