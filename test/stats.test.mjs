/** 跨会话汇总：只喂文本，不碰真实文件系统。 */
import { aggregateDecisions, readGlobalStats, resetStatsCache, DECISIONS_FILE } from "../stats.js";
import { mkdtempSync, writeFileSync, rmSync, appendFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL  " + n + " " + x); } };

const rec = (fields) => JSON.stringify({ v: 1, ts: "2026-01-02T03:04:05.000Z", ...fields });

console.log("1. 空日志");
{
  const out = aggregateDecisions("");
  ok(out.sessions === 0 && out.knives.small.cuts === 0, "空文本给空统计");
  ok(out.attempts.cut === 0 && out.recent.length === 0, "尝试与最近列表都是空");
  ok(aggregateDecisions(undefined).sessions === 0, "undefined 也不抛错");
}

console.log("2. 小刀 / 中刀 / 大刀分别计数");
{
  const text = [
    rec({ sid: "s1", phase: "cut", result: "committed", saved: 8000, tokens: 30000 }),
    rec({ sid: "s1", phase: "cut", result: "committed", saved: 50000, tokens: 120000, merge: true }),
    rec({ sid: "s1", phase: "cut", result: "committed", saved: 2000, tokens: 9000 }),
    rec({ sid: "s2", phase: "cut", result: "committed", saved: 1000, tokens: 4000 }),
    rec({ sid: "s2", phase: "official-handover", result: "ran", before: 400000, after: 60000 }),
  ].join("\n");
  const out = aggregateDecisions(text);
  ok(out.knives.small.cuts === 3 && out.knives.small.saved === 11000, "小刀 3 刀 / 11000（" + out.knives.small.saved + "）");
  ok(out.knives.merge.cuts === 1 && out.knives.merge.saved === 50000, "中刀 1 刀 / 50000");
  ok(out.knives.official.cuts === 1 && out.knives.official.saved === 340000, "大刀切掉 before-after = 340000");
  ok(out.sessions === 2, "两个会话：" + out.sessions);
  ok(out.attempts.cut === 4 && out.attempts.official === 1, "尝试次数");
  ok(out.recent.length === 5 && out.recent[0].kind === "small", "最近列表按时间倒序，同秒时保留插入序");
  ok(out.since > 0, "最早记录时间 " + out.since);
}

console.log("3. 跳过与失败也算尝试");
{
  const text = [
    rec({ sid: "s1", phase: "cut-skip", reason: "no-legal-span" }),
    rec({ sid: "s1", phase: "cut-skip", reason: "no-legal-span" }),
    rec({ sid: "s1", phase: "merge-skip", reason: "break-even" }),
    rec({ sid: "s1", phase: "cut", result: "failed", reason: "raw backup missing" }),
    rec({ sid: "s1", phase: "official-handover", result: "failed", reason: "boom" }),
    rec({ sid: "s1", phase: "official-handover", result: "null" }),
  ].join("\n");
  const out = aggregateDecisions(text);
  ok(out.attempts.cutSkip === 2, "cut-skip 计 2");
  ok(out.attempts.mergeSkip === 1, "merge-skip 计 1");
  ok(out.attempts.failed === 2, "失败计 2（cut + handover）");
  ok(out.attempts.official === 0, "result=null 不算跑过");
  ok(out.knives.official.cuts === 0, "没跑过就不记刀");
}

console.log("4. 坏行不连累整个文件");
{
  const text = [
    rec({ sid: "s1", phase: "cut", result: "committed", saved: 100, tokens: 300 }),
    "{ 这不是 json",
    "",
    "   ",
    "null",
    "[1,2,3]",
    rec({ sid: "s2", phase: "cut", result: "committed", saved: 200, tokens: 400 }),
  ].join("\n");
  const out = aggregateDecisions(text);
  ok(out.knives.small.cuts === 2 && out.sessions === 2, "坏行跳过，好行照收");
}

console.log("5. 缺字段时退化成 0，不产生 NaN");
{
  const text = [rec({ phase: "cut", result: "committed" }), rec({ phase: "official-handover", result: "ran" })].join("\n");
  const out = aggregateDecisions(text);
  ok(out.knives.small.cuts === 1 && out.knives.small.saved === 0, "没有 saved 记 0");
  ok(out.knives.official.cuts === 1 && out.knives.official.saved === 0, "没有 before/after 记 0");
  ok(Number.isFinite(out.knives.small.tokens), "tokens 不是 NaN");
  ok(out.sessions === 0, "没有 sid 不计会话");
}

console.log("6. 读文件：按 mtime 判重");
{
  const dir = mkdtempSync(join(tmpdir(), "spine-stats-"));
  try {
    resetStatsCache();
    ok(readGlobalStats({ dir }).sessions === 0, "没有日志文件时给空统计");
    writeFileSync(join(dir, DECISIONS_FILE), rec({ sid: "s1", phase: "cut", result: "committed", saved: 500, tokens: 900 }) + "\n");
    const first = readGlobalStats({ dir });
    ok(first.sessions === 1 && first.knives.small.cuts === 1, "读到一行就统计出一刀");
    appendFileSync(join(dir, DECISIONS_FILE), rec({ sid: "s2", phase: "cut", result: "committed", saved: 700, tokens: 800, merge: true }) + "\n");
    const second = readGlobalStats({ dir });
    ok(second.sessions === 2 && second.knives.merge.cuts === 1, "文件大了就重新读（" + second.sessions + " 会话）");
    ok(readGlobalStats({ dir }) === second, "同样的文件第二次给同一个对象（缓存命中）");
    ok(readGlobalStats({ dir, ttlMs: 0 }).sessions === 2, "ttl=0 时强制重读也不出错");
    ok(readGlobalStats({}).sessions === 0, "没给目录给空统计");
    ok(readGlobalStats({ dir: join(dir, "nope") }).sessions === 0, "目录不存在给空统计");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("7. 超大日志只读尾巴");
{
  const dir = mkdtempSync(join(tmpdir(), "spine-stats-big-"));
  try {
    resetStatsCache();
    const head = Array.from({ length: 200 }, (_, i) => rec({ sid: "old", phase: "cut-skip", reason: "x" })).join("\n") + "\n";
    const tail = rec({ sid: "new", phase: "cut", result: "committed", saved: 1000, tokens: 2000 }) + "\n";
    writeFileSync(join(dir, DECISIONS_FILE), head + tail);
    const out = readGlobalStats({ dir, maxBytes: 400 });
    ok(out.knives.small.cuts === 1, "只读到尾巴那一刀（" + out.knives.small.cuts + "）");
    ok(readGlobalStats({ dir, maxBytes: 4 * 1024 * 1024 }).sessions === 2, "上限够大时整份都读");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);