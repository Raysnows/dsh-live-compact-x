/** 文档位置：跟着包走，不跟着机器走。 */
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docsFor, hasFile } from "../docs.js";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL  " + n + " " + x); } };

console.log("1. 文件判定");
const dir = mkdtempSync(join(tmpdir(), "spine-docs-"));
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
const other = mkdtempSync(join(tmpdir(), "spine-other-"));
writeFileSync(join(other, "README.md"), "x");
writeFileSync(join(other, "CHANGELOG.md"), "y");
const moved = docsFor(other);
ok(moved.readme.startsWith(other) && moved.readmeExists && moved.changelogExists, "换个目录一样成立");
ok(moved.readme !== docs.readme, "不是写死的同一串路径");

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
