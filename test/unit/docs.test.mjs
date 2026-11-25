/** 文档位置：跟着包走，不跟着机器走。 */
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { makeTemp } from "../fixtures/temp.mjs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docsFor, hasFile, parseChangelog } from "../../src/config/docs.js";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL  " + n + " " + x); } };

console.log("1. 文件判定");
const dir = makeTemp("spine-docs-");
ok(hasFile("") === false && hasFile(undefined) === false, "空路径当没有");
ok(hasFile(join(dir, "nope.md")) === false, "不存在的文件当没有");
writeFileSync(join(dir, "README.md"), "# hi");
ok(hasFile(join(dir, "README.md")) === true, "真的文件才算在");
mkdirSync(join(dir, "CHANGELOG.md"));
ok(hasFile(join(dir, "CHANGELOG.md")) === false, "同名目录不算文件");

console.log("2. 按包目录算路径");
const docs = docsFor(dir, { repo: "https://example.test/r", issues: "https://example.test/i", version: "9.9.9" });
ok(docs.readme === join(dir, "README.md") && docs.changelog === join(dir, "CHANGELOG.md"), "路径拼在包目录下");
ok(docs.readmeExists === true && docs.changelogExists === false, "谁在谁不在分开说");
ok(docs.repo === "https://example.test/r" && docs.version === "9.9.9", "仓库与版本原样带上");

console.log("3. 没解析出目录时的兜底");
const bare = docsFor("");
ok(bare.readme === "" && bare.changelog === "" && bare.readmeExists === false && bare.changelogExists === false, "全空也不抛错");
const weird = docsFor(null);
ok(weird.readme === "" && weird.readmeExists === false, "null 也不抛错");

console.log("4. 换机器换目录：路径跟着传进来的目录走");
const other = makeTemp("spine-other-");
writeFileSync(join(other, "README.md"), "x");
writeFileSync(join(other, "CHANGELOG.md"), "y");
const moved = docsFor(other);
ok(moved.readme.startsWith(other) && moved.readmeExists && moved.changelogExists, "换个目录一样成立");
ok(moved.readme !== docs.readme, "不是写死的同一串路径");

console.log("5. 更新日志拆成「版本 / 日期 / 标题 / 要点」");
const changelog = [
  "# 1.3.24（2026-11-26 面板直接告诉你改了什么）",
  "",
  "- **本版更新卡**：升级后第一眼看到这版改了哪些。",
  "- 收尾停止线下限从 8k 抬到 32k，\`keepRoundTokens\` 不再和小刀撞车。",
  "",
  "# 1.3.23（2026-11-25 脱敏诊断）",
  "",
  "- 一键复制脱敏诊断。",
  "",
  "# 1.3.22（2026-11-25 修 rc.12）",
  "",
  "- 兜住 ctx.root。",
].join("\n");
const parsed = parseChangelog(changelog, { limit: 2 });
ok(parsed.entries.length === 2 && parsed.truncated === true, "按 limit 截断并说明还有更多");
const head = parsed.entries[0];
ok(head.version === "1.3.24" && head.date === "2026-11-26", "版本与日期分开：" + head.version + " / " + head.date);
ok(head.title === "面板直接告诉你改了什么", "标题去掉日期与括号：" + head.title);
ok(head.bullets.length === 2, "两条要点都在（" + head.bullets.length + "）");
ok(!head.bullets[0].includes("**") && head.bullets[1].includes("keepRoundTokens"), "去掉 ** 与反引号，正文照原样");
ok(parseChangelog("").entries.length === 0, "空文本不抛错");
ok(parseChangelog("# 9.9.9").entries[0].version === "9.9.9" && parseChangelog("# 9.9.9").entries[0].date === "", "没日期就是空串");
const longBullet = parseChangelog("# 1.0.0\n- " + "甲".repeat(400), { bulletChars: 100 }).entries[0].bullets[0];
ok(longBullet.length === 100 && longBullet.endsWith("…"), "过长的要点截断并加省略号（" + longBullet.length + "）");

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
