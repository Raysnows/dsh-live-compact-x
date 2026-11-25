import { attachBackupHint, attachLogRecall, buildCard, conclusionFacts, touchedPaths, unknownKeptLines } from "../../src/engine/plan.js";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + " " + x); } };

const assistant = (seq, text) => ({ role: "assistant", seq, turn: 20, text });
const tool = (seq, text, extra = {}) => ({ role: "tool", seq, turn: 20, name: "run_code", toolCallId: "call_" + seq, text, ...extra });

console.log("1. 助手结论被转写，并带事件号");
{
  const spans = [
    { role: "user", seq: 2100, turn: 19, text: "修好面板，不要动上游。" },
    assistant(2140, "我先看配置。\n根因是 presets.js 的 exports 少了 ./package.json，加载器解析不到。\n已修复：补上 exports 并重装，面板恢复正常。"),
    tool(2146, "PASS 634 tests, 0 failed"),
  ];
  const card = buildCard(spans.map((s) => s.text).join("\n"), "", spans, {});
  ok(card.text.includes("结论（当时的说法"), "有结论段");
  ok(card.text.includes("[根因] 根因是 presets.js"), "根因句被保留");
  ok(card.text.includes("已修复：补上 exports"), "修复结论被保留");
  ok(card.text.includes("（seq 2140）"), "带事件号 " + card.text.slice(card.text.indexOf("seq 2140") - 6, card.text.indexOf("seq 2140") + 10));
  ok(card.text.includes("出现过的文件（未必改过）：") && card.text.includes("package.json"), "文件清单带「未必改过」且 extension 不被截断");
  ok(!card.text.includes("package.js、"), "package.json 不写成 package.js");
  ok(card.ok === true, "卡片可提交（已转写的句子不算缺事实）");
}

console.log("2. 未验证的假设显式标出来");
{
  const spans = [assistant(2250, "未验证：这是不是宿主缓存导致的，需要重启再看。"), tool(2251, "ok")];
  const card = buildCard(spans.map((s) => s.text).join("\n"), "", spans, {});
  ok(card.text.includes("[未验证] 未验证："), "标 [未验证]");
  const facts = conclusionFacts(spans);
  ok(facts.lines.length === 1 && facts.lines[0].tag === "未验证", "分类正确 " + facts.lines[0]?.tag);
}

console.log("3. 长工具输出取首行与关键行，不只取末尾噪声");
{
  const text = ["PASS 634 tests, 0 failed", "noise 1", "noise 2", "noise 3", "File sandbox: danger-full-access."].join("\n");
  const kept = unknownKeptLines(text);
  ok(kept[0].startsWith("PASS 634"), "首行保留：" + kept[0]);
  ok(kept.length <= 4, "最多 4 行 " + kept.length);
  const long = ["line 0", ...Array.from({ length: 40 }, (_v, i) => "filler " + i), "FAIL 3 of 40 cases", "tail line"].join("\n");
  const picked = unknownKeptLines(long);
  ok(picked.some((line) => line.includes("FAIL 3 of 40")), "关键行保留：" + picked.join(" | "));
  ok(picked.every((line) => line.length <= 203), "单行截断 200 字符");
}

console.log("4. 证据与指针有上限，并写明剩余条数");
{
  const spans = Array.from({ length: 20 }, (_v, i) => tool(3000 + i * 2, "done " + i));
  const card = buildCard(spans.map((s) => s.text).join("\n"), "", spans, {});
  const evidenceLines = card.text.split("\n").filter((line) => /^\- 第 \d+ 轮/.test(line));
  ok(evidenceLines.length <= 11, "证据行有上限 " + evidenceLines.length);
  ok(card.text.includes("另有") && card.text.includes("条未列"), "写明剩余条数");
  ok(card.text.split("\n").filter((line) => line.startsWith("* ")).length <= 9, "指针行有上限");
}

console.log("5. 没有助手结论时不写空标题");
{
  const spans = [tool(2146, "PASS 1 test"), { role: "user", seq: 2100, turn: 19, text: "继续" }];
  const card = buildCard(spans.map((s) => s.text).join("\n"), "", spans, {});
  ok(!card.text.includes("结论（当时的说法"), "无结论就不出这一节");
  ok(conclusionFacts(spans).lines.length === 0, "抽取结果为空");
}

console.log("6. 卡片整体体积可控");
{
  const big = Array.from({ length: 30 }, (_v, i) => tool(4000 + i * 2, Array.from({ length: 30 }, (_w, j) => "row " + i + "-" + j).join("\n")));
  const spans = [assistant(3999, "结论：这一轮只是探查，没有改文件。"), ...big];
  const card = buildCard(spans.map((s) => s.text).join("\n"), "", spans, {});
  ok(card.text.length < 4000, "30 个工具调用的卡片仍在 4000 字符内：" + card.text.length);
}

console.log("7. touchedPaths 去重、排序、限量");
{
  const spans = [
    { role: "tool", seq: 1, text: "wrote C:\\a\\main.js\nread C:\\a\\main.js\nand C:\\a\\b\\util.js" },
    { role: "assistant", seq: 2, text: "改了 C:\\a\\main.js" },
  ];
  const paths = touchedPaths(spans, { limit: 2 });
  ok(paths.length === 2, "限量 2：" + paths.join(" | "));
  ok(paths[0].toLowerCase().endsWith("main.js"), "次数最多的排前面：" + paths[0]);
}

console.log("8. 新 AI 看不清的三处：seq 含义、时间、备份路径");
{
  const spans = [
    { role: "assistant", seq: 2140, turn: 21, time: 1795500000000, text: "根因是 presets.js 少了 exports。\n已修复。" },
    { role: "tool", seq: 2146, turn: 21, time: 1795500060000, name: "run_code", text: "PASS 1 test" },
    { role: "user", seq: 2100, turn: 20, time: 1795499000000, text: "修好面板，不要动上游。" },
  ];
  const card = buildCard(spans.map((s) => s.text).join("\n"), "", spans, {});
  ok(card.text.includes("括号=事件号 seq"), "结论段写明 seq 是事件号");
  ok(/截于 \d{4}-\d{2}-\d{2} \d{2}:\d{2}\b/.test(card.text), "统计行带完整截断时间（YYYY-MM-DD HH:mm）：" + (card.text.match(/截于[^。]*/) || [""])[0]);
  ok(card.text.includes("原文（用户约束 + 工具输出；[tool] 不是用户的话）"), "原文节标题区分用户约束与工具输出");
  const noTime = buildCard(spans.map((s) => ({ ...s, time: undefined })).map((s) => s.text).join("\n"), "", spans.map((s) => ({ ...s, time: undefined })), {});
  ok(!noTime.text.includes("截于"), "没有时间信息就不写时间戳");
}

console.log("9. 备份路径要真的写进卡片");
{
  const card = { text: "Spine extract.\n保留 1 行。", ok: true };
  const withHint = attachBackupHint(card, "D:/shadow/session-x/cut-1-abcdef12.txt");
  ok(withHint.text.includes("省略的工具原文在 D:/shadow/session-x/cut-1-abcdef12.txt"), "正文里带路径");
  ok(withHint.backupId && withHint.shadowFile, "字段仍然挂着");
  const again = attachBackupHint(withHint, "D:/shadow/session-x/cut-1-abcdef12.txt");
  ok(again.text.split("省略的工具原文在").length === 2, "重复挂不重复写");
  const noFile = attachBackupHint(card, "");
  ok(noFile.text === card.text, "没有备份文件就不动正文");
}

console.log("10. 没有本地副本时，卡片要指路到会话日志");
{
  const card = { text: "Spine extract.\n回读位置：seq 2146", ok: true, needsBackup: true };
  const recalled = attachLogRecall({ ...card, needsBackup: false });
  ok(recalled.text.includes("按事件号（seq）回读会话日志"), "写明按 seq 回读日志：\n" + recalled.text);
  ok(recalled.needsBackup === false, "不落副本就不再要求 backup");
  const again = attachLogRecall(recalled);
  ok(again.text.split("按事件号（seq）回读会话日志").length === 2, "重复调用不重复写");
  const withCopy = attachBackupHint(card, "/tmp/cut-1.txt");
  ok(!withCopy.text.includes("这张卡没有本地副本"), "有副本时不写「没有副本」");
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
