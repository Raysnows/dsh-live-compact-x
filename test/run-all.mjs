#!/usr/bin/env node
/**
 * 全量测试入口：干净 clone 上 `npm test` 就能跑，不依赖某台机器的目录。
 * - unit/ 与 e2e/ 下的 *.test.mjs 全部跑一遍；
 * - 需要替身宿主包的（big-method / zero-copy）挂 fixtures/host-loader.mjs；
 * - v2 回读测试自己造合成日志，给了 SPINE_V2_FIXTURE 才用真实会话。
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = dirname(here);
const loader = "test/fixtures/host-loader.mjs";
const WITH_LOADER = new Set(["test/unit/zero-copy.test.mjs", "test/unit/big-method.test.mjs"]);

const listing = (dir) => {
  try {
    return readdirSync(join(here, dir)).filter((name) => name.endsWith(".test.mjs")).sort()
      .map((name) => "test/" + dir + "/" + name);
  } catch { return []; }
};
const files = [...listing("unit"), ...listing("e2e")];

let total = 0;
let bad = 0;
for (const file of files) {
  const args = [];
  if (WITH_LOADER.has(file)) args.push("--experimental-loader", "./" + loader);
  args.push(file);
  if (file === "test/e2e/v2.test.mjs" && process.env.SPINE_V2_FIXTURE) args.push(process.env.SPINE_V2_FIXTURE);
  const run = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
  const out = (run.stdout || "") + (run.stderr || "");
  const m = out.match(/通过 (\d+) \/ 失败 (\d+)/);
  if (!m) {
    bad = 1;
    console.log("NO-SUMMARY " + file);
    console.log(out.split("\n").slice(-12).join("\n"));
    continue;
  }
  total += Number(m[1]);
  if (Number(m[2]) > 0) { bad = 1; console.log("FAILED " + file + " " + m[1] + "/" + m[2]); }
  else console.log("ok " + file + " " + m[1]);
}
console.log("TOTAL_ASSERTIONS=" + total + " BAD=" + bad);
process.exit(bad ? 1 : 0);
