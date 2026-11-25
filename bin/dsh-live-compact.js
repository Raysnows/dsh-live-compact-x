#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCutStats } from "../src/engine/shadow.js";

const pkg = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../package.json"), "utf8"));
const arg = process.argv[2];
if (arg === "stats") {
  const dir = process.env.SPINE_SHADOW_DIR || join(process.env.DSH_HOME || join(homedir(), ".dsh"), "compaction-spine", "shadow");
  const stats = readCutStats(dir);
  const usd = (stats.savedTokens * 0.15) / 1e6;
  console.log(`cuts ${stats.cuts}`);
  console.log(`saved ${stats.savedTokens}`);
  console.log(`rewrite ${stats.rewriteTokens}`);
  console.log(`估算 $${usd.toFixed(2)}，saved × $0.15/M，未扣除重写未命中成本`);
  process.exit(0);
}
if (arg === "--version" || arg === "-v") {
  console.log(pkg.version);
  process.exit(0);
}
console.log(`${pkg.name} ${pkg.version}`);
// 安装提示只给 npm 包名。自建下载站那个域名现在回的是 HTML 页面，
// 拿它当「安装源」会直接撞 ERR_PNPM_BROKEN_METADATA_JSON（不是 JSON）。
console.log(`dsh plugin --profile web add ${pkg.name}`);
console.log(`钉版本：npm i ${pkg.name}@${pkg.version}`);
