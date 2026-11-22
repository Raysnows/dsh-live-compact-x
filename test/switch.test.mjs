/** 总开关：文件读写、范围、坏文件、重启后仍然记得。 */
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL  " + n + " " + x); } };

const work = mkdtempSync(join(tmpdir(), "spine-switch-"));
const file = join(work, "spine-switch.json");
process.env.SPINE_SWITCH_FILE = file;

const S = await import("file:///D:/deepseek-workspaces/work/plugins/dsh-live-compact-x/switch.js");

console.log("1. 默认是开着");
{
  const state = S.readSwitchState();
  ok(state.enabled === true && state.disabled.length === 0, "没有文件时默认开启");
  ok(S.compactionEnabled("s1") === true, "会话也默认开启");
  ok(S.switchSnapshot("s1").global === true && S.switchSnapshot("s1").session === true, "快照两个层级都是开");
  ok(S.switchFilePath() === file, "路径跟着 SPINE_SWITCH_FILE 走");
}

console.log("2. 全部会话关闭 / 打开");
{
  const next = await S.setSwitchState({ scope: "all", enabled: false });
  ok(next.enabled === false, "返回新状态");
  ok(existsSync(file), "落盘了");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  ok(raw.enabled === false, "文件里是 enabled=false");
  ok(S.compactionEnabled("s1") === false && S.compactionEnabled("s2") === false, "任何会话都停");
  ok(S.switchSnapshot("s1").global === false && S.switchSnapshot("s1").session === false, "快照两级都关");
  await S.setSwitchState({ scope: "all", enabled: true });
  ok(S.compactionEnabled("s1") === true, "再打开就恢复");
}

console.log("3. 单会话关闭");
{
  await S.setSwitchState({ scope: "session", enabled: false, sid: "s1" });
  ok(S.compactionEnabled("s1") === false, "s1 停");
  ok(S.compactionEnabled("s2") === true, "别的会话不受影响");
  const snap = S.switchSnapshot("s1");
  ok(snap.global === true && snap.session === false && snap.sessionDisabled === true, "快照说清楚是会话级关闭");
  ok(snap.disabledCount === 1, "关掉的会话数 1");
  await S.setSwitchState({ scope: "session", enabled: true, sid: "s1" });
  ok(S.compactionEnabled("s1") === true && S.switchSnapshot("s1").disabledCount === 0, "再打开就移出名单");
  await S.setSwitchState({ scope: "session", enabled: false, sid: "s1" });
  await S.setSwitchState({ scope: "session", enabled: false, sid: "s1" });
  ok(S.switchSnapshot("s1").disabledCount === 1, "重复关不重复记账");
}

console.log("4. 参数要拦住");
{
  let threw = 0;
  for (const bad of [{}, { scope: "nope", enabled: true }, { scope: "all" }, { scope: "session", enabled: false }, { scope: "all", enabled: "no" }]) {
    try { await S.setSwitchState(bad); } catch { threw += 1; }
  }
  ok(threw === 5, "五个坏参数全被拒（" + threw + "）");
}

console.log("5. 文件坏了就当开着，不装死");
{
  writeFileSync(file, "{oops", "utf8");
  const state = S.readSwitchState();
  ok(state.enabled === true && state.disabled.length === 0, "读坏文件回默认开启");
  ok(S.compactionEnabled("s1") === true, "坏文件不误关");
}

console.log("6. 原子写：不留临时文件，重启后还在");
{
  await S.setSwitchState({ scope: "session", enabled: false, sid: "s9" });
  const leftovers = readdirSync(work).filter((name) => name.includes(".tmp-"));
  ok(leftovers.length === 0, "没有残留 .tmp 文件");
  const fresh = await import("file:///D:/deepseek-workspaces/work/plugins/dsh-live-compact-x/switch.js?restart=1");
  ok(fresh.readSwitchState().disabled.includes("s9"), "新进程（重新引入）从文件读回 s9");
  ok(fresh.compactionEnabled("s9") === false && fresh.compactionEnabled("s1") === true, "重启后仍然只停 s9");
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exitCode = fail ? 1 : 0;
