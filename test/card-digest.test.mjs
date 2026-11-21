import { digestMissingFacts } from "../plan.js";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + " " + x); } };

console.log("1. 没有缺失时原样返回");
{
  const card = { ok: true, text: "正文", missing: [], hardLines: [] };
  const out = digestMissingFacts(card);
  ok(out.ok === true && out.degraded === false && out.degradedFacts === 0, "不标记降级");
  ok(out.text === "正文", "正文不动");
  const noList = digestMissingFacts({ ok: false, text: "x" });
  ok(noList.ok === true && noList.degraded === false, "缺 missing 字段也能收口");
}

console.log("2. 缺失事实被截断摘要补进正文");
{
  const long = "A".repeat(600);
  const card = { ok: false, text: "正文", missing: [long, "短的一条"] };
  const out = digestMissingFacts(card);
  ok(out.ok === true && out.degraded === true, "补全后可以提交，但标记 degraded");
  ok(out.degradedFacts === 2, "记录缺失条数 " + out.degradedFacts);
  ok(out.text.startsWith("正文\n\n"), "摘要追加在正文之后");
  ok(out.text.includes("未逐字保留（1）"), "逐条编号");
  ok(out.text.includes("A".repeat(240)) && !out.text.includes("A".repeat(241)), "长行截断到 240 字符");
  ok(out.text.includes(" …"), "截断处有省略标记");
  ok(out.text.includes("未逐字保留（2）: 短的一条") && !out.text.includes("短的一条 …"), "短行不加省略标记");
}

console.log("3. 条数上限与剩余计数");
{
  const missing = Array.from({ length: 100 }, (_v, i) => "事实 " + i);
  const out = digestMissingFacts({ ok: false, text: "t", missing }, { limit: 64 });
  ok(out.degradedFacts === 100, "degradedFacts 记总数 " + out.degradedFacts);
  ok(out.text.includes("未逐字保留（64）"), "最多列 64 条");
  ok(!out.text.includes("未逐字保留（65）"), "第 65 条不列");
  ok(out.text.includes("另有 36 条同类事实未逐字保留"), "剩余条数写清楚");
}

console.log("4. 空白条目被过滤，自定义截断长度生效");
{
  const out = digestMissingFacts({ ok: false, text: "t", missing: ["   ", "", "x".repeat(100)] }, { charsPerLine: 20 });
  ok(out.degradedFacts === 1, "只剩一条 " + out.degradedFacts);
  ok(out.text.includes("x".repeat(20)) && !out.text.includes("x".repeat(21)), "20 字符截断");
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
