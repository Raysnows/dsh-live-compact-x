/** 跨会话汇总：只喂文本，不碰真实文件系统。 */
import { aggregateDecisions, readGlobalStats, resetStatsCache, sidKey, firstActivityOf, officialHandoversOf, DECISIONS_FILE } from "../../src/engine/stats.js";
import { makeTemp } from "../fixtures/temp.mjs";
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
  ok(out.knives.big.cuts === 1 && out.knives.big.saved === 340000, "大刀（插件请官方摘要）切掉 before-after = 340000");
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
  ok(out.knives.big.cuts === 0, "没跑过就不记刀");
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
  ok(out.knives.big.cuts === 1 && out.knives.big.saved === 0, "没有 before/after 记 0");
  ok(Number.isFinite(out.knives.small.tokens), "tokens 不是 NaN");
  ok(out.sessions === 0, "没有 sid 不计会话");
}

console.log("6. 读文件：按 mtime 判重");
{
  const dir = makeTemp("spine-stats-");
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

console.log("7. 会话名归一与「第一次碰它」的时间");
{
  ok(sidKey("session-abc") === "abc" && sidKey("abc") === "abc", "session- 前缀剥掉");
  ok(sidKey("memory-xyz") === "xyz" && sidKey("") === "", "memory- 前缀也认");
  const text = [
    rec({ sid: "session-a", ts: "2026-01-02T03:00:00.000Z", phase: "engine", engine: "local" }),
    rec({ sid: "session-a", ts: "2026-01-02T05:00:00.000Z", phase: "cut", result: "committed", saved: 100, tokens: 200 }),
    rec({ sid: "session-b", ts: "2026-01-02T04:00:00.000Z", phase: "engine", engine: "local" }),
  ].join("\n");
  const out = aggregateDecisions(text);
  ok(Object.keys(out.firstBySid).length === 2, "每个会话一条最早记录");
  ok(out.firstBySid["session-a"] === Date.parse("2026-01-02T03:00:00.000Z"), "取的是最早那条（数值毫秒）");
  ok(firstActivityOf(out, "a") === Date.parse("2026-01-02T03:00:00.000Z"), "查的时候不用带 session- 前缀");
  ok(firstActivityOf(out, "session-a") === firstActivityOf(out, "a"), "带不带前缀都一样");
  ok(firstActivityOf(out, "unknown") === 0 && firstActivityOf(null, "a") === 0, "查不到给 0");
  ok(sidKey("--D-work--/session-abc") === "abc", "工作区前缀也剥掉");
  ok(firstActivityOf(out, "workspace--/session-a") === Date.parse("2026-01-02T03:00:00.000Z"), "带工作区前缀也能对上同一条会话");
  ok(firstActivityOf(out, "workspace--/session-zzz") === 0, "对不上的名字不乱认");
  const padded = aggregateDecisions(rec({ sid: "session-abcdef123456", ts: "2026-01-02T03:00:00.000Z", phase: "engine" }));
  ok(firstActivityOf(padded, "session-abcdef123456") > 0, "同一条会话换个前缀写法仍能对上");
}

console.log("7b. 大刀认领表：只收 official-handover ran 的时间点");
{
  const t1 = "2026-11-27T01:00:00.000Z";
  const t2 = "2026-11-27T02:00:00.000Z";
  const out = aggregateDecisions([
    rec({ sid: "s1", ts: t1, phase: "official-handover", result: "ran", before: 400000, after: 60000 }),
    rec({ sid: "s1", ts: t2, phase: "official-handover", result: "ran", before: 300000, after: 50000 }),
    // 失败与空结果不算：那一刀没落地
    rec({ sid: "s2", ts: t1, phase: "official-handover", result: "failed" }),
    rec({ sid: "s2", ts: t2, phase: "official-handover", result: "null" }),
    // 顺带确认：只有 deferred 也不算
    rec({ sid: "s3", ts: t1, phase: "official-handover", result: "deferred" }),
  ].join("\n"));
  ok(Array.isArray(out.officialHandovers.s1) && out.officialHandovers.s1.length === 2, "两次 ran 各留一个时间点");
  ok(out.officialHandovers.s1[0] === Date.parse(t1), "时间点按毫秒保存");
  ok(out.officialHandovers.s2 === undefined, "failed / null 不留认领点");
  ok(out.officialHandovers.s3 === undefined, "deferred 不留认领点");

  const list = officialHandoversOf(out, "s1");
  ok(list.length === 2 && list[0] <= list[1], "officialHandoversOf 返回升序时间点");
  ok(officialHandoversOf(out, "session-s1").length === 2, "会话名少了 session- 前缀也能对上");
  ok(officialHandoversOf(out, "nobody").length === 0, "没有记录的会话返回空数组");
  ok(officialHandoversOf({}, "s1").length === 0, "aggregate 缺字段也不抛错");
}

console.log("8. 超大日志只读尾巴");{
  const dir = makeTemp("spine-stats-big-");
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