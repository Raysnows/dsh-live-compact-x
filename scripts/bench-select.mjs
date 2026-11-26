/**
 * 实测对照：同一段真实会话，旧逻辑（先到先得）vs 新逻辑（带预算选优）。
 * 只读会话日志，不联网。用法：node scripts/bench-select.mjs <session.jsonl>
 */
import { readFileSync } from "node:fs";
import { buildCard } from "../src/engine/plan.js";
import { lineValue } from "../src/engine/select.js";

const file = process.argv[2];
if (!file) { console.error("usage: node scripts/bench-select.mjs <session.jsonl>"); process.exit(2); }

const lines = readFileSync(file, "utf8").split("\n").filter(Boolean);
const texts = [];
for (const line of lines) {
  let record;
  try { record = JSON.parse(line); } catch { continue; }
  const data = record?.data || {};
  const message = data.message || {};
  if (record.type !== "tool/result" && record.type !== "user/message") continue;
  const content = message.content;
  const chunk = Array.isArray(content)
    ? content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("")
    : "";
  if (chunk.length > 200) texts.push(chunk);
}

// 取最近 120 段工具输出当一刀的整段（真实分布，不做人工挑选）。
const span = texts.slice(-120).join("\n");
const spanLines = span.split("\n").filter((line) => line.trim().length > 8);
const valuable = spanLines.filter((line) => lineValue(line) >= 3.5);
const hasIssue = (text, line) => text.includes(line.slice(0, 40));

const budget = Number(process.argv[3]) || 32000;
const flat = buildCard(span, "", [{ role: "tool", text: span }], { keepBudget: budget });
const ranked = buildCard(span, "", [{ role: "tool", text: span }], { keepBudget: budget, ranked: true });

const report = (label, card) => {
  const keptValuable = valuable.filter((line) => hasIssue(card.text, line)).length;
  const keptLines = card.text.split("\n").filter((line) => line.startsWith("- ["));
  console.log([
    label,
    "ok=" + card.ok,
    "hard=" + card.hardCount,
    "缺=" + card.missing.length,
    "keptChars=" + card.keptChars,
    "卡片行=" + keptLines.length,
    "高价值行保留=" + keptValuable + "/" + valuable.length,
    "卡片/原文=" + (card.text.length / span.length * 100).toFixed(1) + "%",
  ].join("  "));
};

console.log("整段：" + span.length + " 字符，" + spanLines.length + " 行，高价值行 " + valuable.length + " 条");
report("先到先得 ", flat);
report("带预算选优", ranked);
