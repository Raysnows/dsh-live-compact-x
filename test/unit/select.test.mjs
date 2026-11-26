/** 选行：预算是硬约束，价值密度决定顺序，去重防止同一段报错被抄五遍。 */
import { lineValue, selectLines, tokensOf } from "../../src/engine/select.js";
import { buildCard } from "../../src/engine/plan.js";

let pass = 0, fail = 0;
const ok = (c, n) => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL  " + n); } };

console.log("1. 价值打分");
ok(lineValue("") === 0, "空行 0 分");
ok(lineValue("这是一句普通叙述") >= 1, "普通行至少 1 分");
ok(lineValue("构建失败: exit code 1") > lineValue("这是一句普通叙述"), "报错行比叙述值钱");
ok(lineValue("必须保留 README 里的安装段") > lineValue("今天天气不错"), "用户约束最值钱");
ok(lineValue("C:\\work\\a.js:12 出错") > lineValue("看了一段代码"), "带路径的行加分");
ok(lineValue("npm i dsh-live-compact-x@1.3.32") > lineValue("装一下"), "命令比口语值钱");
ok(lineValue("x".repeat(2000)) < lineValue("短行 token=1200"), "超长行被长度惩罚");

console.log("2. Jaccard 去重");
{
  const a = tokensOf("spine: card incomplete, missing facts 12");
  const b = tokensOf("spine: card incomplete, missing facts 13");
  const c = tokensOf("完全不相干的一句中文");
  const sim = (x, y) => { let s = 0; for (const t of x) if (y.has(t)) s++; return s / (x.size + y.size - s); };
  ok(sim(a, b) > 0.5, "近重复的两行相似度高：" + sim(a, b).toFixed(2));
  ok(sim(a, c) < 0.05, "不相干的两行相似度低：" + sim(a, c).toFixed(2));
}

console.log("3. 预算内的贪心选择");
{
  const items = [
    { text: "a".repeat(100), required: true },
    { text: "b".repeat(100) },
    { text: "c".repeat(100) },
    { text: "d".repeat(100) },
  ];
  const picked = selectLines(items, { budget: 250 });
  ok(picked.used <= 250, "不超预算：" + picked.used);
  ok(picked.kept.includes(0), "required 一定在里面");
  ok(picked.kept.length === 2, "预算装得下两行：" + picked.kept.join(","));

  const tight = selectLines(items, { budget: 100 });
  ok(tight.kept.length === 1 && tight.kept[0] === 0 && tight.requiredDropped === 0, "只够一行时先保 required");

  const none = selectLines(items, { budget: 0 });
  ok(none.kept.length === 0 && none.requiredDropped === 1, "预算 0：required 装不下也算 dropped");
}

console.log("4. 价值高的后段行不会被挤掉");
{
  const items = [];
  for (let i = 0; i < 20; i++) items.push({ text: "普通工具输出第 " + i + " 行，长度差不多" + "。".repeat(20) });
  items.push({ text: "构建失败：exit code 1，Error: cannot find module 'x'" });
  const picked = selectLines(items, { budget: 300 });
  ok(picked.kept.includes(items.length - 1), "最后一条报错行被选中（旧逻辑会因预算耗尽丢掉）");
  ok(picked.used <= 300, "预算仍然是硬约束：" + picked.used);
  ok(picked.kept.length < items.length, "装不下的被丢掉：" + picked.kept.length + "/" + items.length);
}

console.log("5. 去重：同一段报错只留一条");
{
  const dup = "spine: local script summarizer produced an incomplete card (missing 12 facts)";
  const items = [
    { text: dup },
    { text: dup.replace("12", "13") },
    { text: dup.replace("12", "14") },
    { text: "完全不同的另一段：安装命令 npm i dsh-live-compact-x" },
  ];
  const picked = selectLines(items, { budget: 1000, lambda: 0.9 });
  const keptDup = picked.kept.filter((i) => i !== 3).length;
  ok(keptDup === 1, "三条近重复只留一条：" + picked.kept.join(","));
  ok(picked.kept.includes(3), "不重复的那条仍在");
}

console.log("6. buildCard 的脚本模式（ranked）保后段事实");
{
  const filler = Array.from({ length: 300 }, (_, i) => "tool line " + i + " " + "x".repeat(40)).join("\n");
  const late = "最后 20 行里：构建失败 exit code 1，必须修掉 README 的安装段";
  const span = filler + "\n" + late;
  const flat = buildCard(span, "", [{ role: "tool", text: span }], { keepBudget: 2000 });
  const ranked = buildCard(span, "", [{ role: "tool", text: span }], { keepBudget: 2000, ranked: true });
  ok(ranked.keptChars <= 2000 && flat.keptChars <= 2000, "两种都在预算内：" + flat.keptChars + " / " + ranked.keptChars);
  ok(ranked.text.includes("exit code 1"), "ranked 卡片保住了后段的失败行");
  ok(ranked.hardCount >= 1, "硬事实计数正常：" + ranked.hardCount);
}

console.log("\n通过 " + pass + " / 失败 " + fail);
if (fail) process.exitCode = 1;
