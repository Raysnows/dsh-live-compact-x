/** 自定义档：三个范围、层级优先级、文件坏了不装死、参数要拦住。 */
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { makeTemp } from "../fixtures/temp.mjs";
import { join } from "node:path";
import { tmpdir } from "node:os";

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL  " + n + " " + x); } };

const work = makeTemp("spine-presets-");
const file = join(work, "spine-presets.json");
const sessions = join(work, "sessions");
process.env.SPINE_PRESETS_FILE = file;
process.env.SPINE_SESSIONS_DIR = sessions;
mkdirSync(join(sessions, "--D-ws--", "sess-a"), { recursive: true });
mkdirSync(join(sessions, "--D-ws--", "session-sess-b"), { recursive: true });
mkdirSync(join(sessions, "--D-other--", "sess-c"), { recursive: true });

const P = await import(new URL("../../src/config/presets.js", import.meta.url));

console.log("1. 会话 → 工作区");
{
  ok(P.workspaceKeyForSession("sess-a") === "--D-ws--", "sess-a 认到 --D-ws--");
  ok(P.workspaceKeyForSession("sess-b") === "--D-ws--", "session- 前缀的目录也认");
  ok(P.workspaceKeyForSession("session-sess-a") === "--D-ws--", "带 session- 的 id 也能认到同一目录");
  ok(P.workspaceKeyForSession("sess-c") === "--D-other--", "别的会话认别的工作区");
  ok(P.workspaceKeyForSession("nobody") === "", "找不到就空串，不瞎猜");
  ok(P.workspaceKeyForSession("") === "", "空 sid 不扫盘");
}

console.log("2. 没有文件时是空档");
{
  ok(!existsSync(file), "还没写过");
  const snap = P.presetsSnapshot("sess-a");
  ok(snap.scopes.session.items.length === 0 && snap.scopes.workspace.items.length === 0 && snap.scopes.all.items.length === 0, "三个范围都空");
  ok(snap.layer === null && P.presetLayerFor("sess-a") && Object.keys(P.presetLayerFor("sess-a")).length === 0, "没有生效档");
  ok(snap.workspaceKnown === true && snap.workspaceKey === "--D-ws--", "工作区识别出来了");
}

console.log("3. 本会话档：只影响这一条");
{
  const saved = await P.savePreset({ scope: "session", sid: "sess-a", name: "夜间省流", values: { minTokens: 12345, officialAbove: 220000 } });
  ok(existsSync(file), "落盘了");
  ok(saved.id && saved.presets.scopes.session.items.length === 1, "返回新档 id");
  ok(saved.presets.scopes.session.active === saved.id, "存完自动成为当前档");
  ok(P.presetLayerFor("sess-a").minTokens === 12345, "sess-a 用上了");
  ok(Object.keys(P.presetLayerFor("sess-b")).length === 0, "sess-b 没被波及");
  const raw = JSON.parse(readFileSync(file, "utf8"));
  ok(raw.scopes["session:sess-a"].items[0].values.officialAbove === 220000, "文件里按范围存");
}

console.log("4. 全部会话档 + 会话覆盖");
{
  const all = await P.savePreset({ scope: "all", sid: "sess-a", name: "全站省流", values: { minTokens: 1000, bigGate: 600000 } });
  ok(P.presetLayerFor("sess-c").bigGate === 600000, "全部会话档对谁都生效");
  ok(P.presetLayerFor("sess-a").minTokens === 12345, "本会话盖住全部");
  const snap = P.presetsSnapshot("sess-a");
  ok(snap.layer && snap.layer.scope === "session", "快照说清最高优先级是会话");
  const allSnap = P.presetsSnapshot("sess-c");
  ok(allSnap.layer && allSnap.layer.scope === "all", "sess-c 生效的是全部会话档");
  ok(all.id && allSnap.scopes.all.items.length === 1, "全部会话档只有一份");
}

console.log("5. 工作区档：同工作区都吃，优先级在中间");
{
  const ws = await P.savePreset({ scope: "workspace", sid: "sess-a", name: "工作区档", values: { minTokens: 7777 } });
  ok(P.presetLayerFor("sess-b").minTokens === 7777, "同工作区的 sess-b 用上了");
  ok(P.presetLayerFor("sess-a").minTokens === 12345, "sess-a 仍被会话档盖住");
  ok(P.presetLayerFor("sess-c").minTokens === 1000, "别的工作区不受影响");
  await P.applyPreset({ scope: "session", sid: "sess-a", id: "" });
  ok(P.presetLayerFor("sess-a").minTokens === 7777, "取消会话档后落到工作区档");
  await P.applyPreset({ scope: "workspace", sid: "sess-a", id: "" });
  ok(P.presetLayerFor("sess-a").minTokens === 1000, "再取消工作区档就落到全部会话档");
  await P.applyPreset({ scope: "workspace", sid: "sess-a", id: ws.id });
  ok(P.presetLayerFor("sess-a").minTokens === 7777, "再套用回来");
}

console.log("6. 改档 / 删档");
{
  const list = P.presetsSnapshot("sess-a").scopes.session.items;
  const id = list[0].id;
  await P.savePreset({ scope: "session", sid: "sess-a", id, name: "夜间省流 2", values: { minTokens: 23456 } });
  const after = P.presetsSnapshot("sess-a").scopes.session.items;
  ok(after.length === 1 && after[0].name === "夜间省流 2" && after[0].values.minTokens === 23456, "给了 id 就是改，不新增");
  await P.applyPreset({ scope: "all", sid: "sess-a", id: P.presetsSnapshot("sess-a").scopes.all.items[0].id });
  await P.deletePreset({ scope: "all", sid: "sess-a", id: P.presetsSnapshot("sess-a").scopes.all.items[0].id });
  ok(P.presetsSnapshot("sess-a").scopes.all.items.length === 0, "删掉了");
  ok(Object.keys(P.presetLayerFor("sess-c")).length === 0, "删掉生效档后就不再生效");
}

console.log("7. 参数要拦住");
{
  const bad = [
    () => P.savePreset({ scope: "nope", sid: "sess-a", name: "x", values: { minTokens: 1 } }),
    () => P.savePreset({ scope: "session", name: "x", values: { minTokens: 1 } }),
    () => P.savePreset({ scope: "workspace", sid: "nobody", name: "x", values: { minTokens: 1 } }),
    () => P.savePreset({ scope: "session", sid: "sess-a", name: "  ", values: { minTokens: 1 } }),
    () => P.savePreset({ scope: "session", sid: "sess-a", name: "很长".repeat(20), values: { minTokens: 1 } }),
    () => P.savePreset({ scope: "session", sid: "sess-a", name: "x", values: { nope: 1 } }),
    () => P.savePreset({ scope: "session", sid: "sess-a", name: "x", values: { minTokens: -1 } }),
    () => P.savePreset({ scope: "session", sid: "sess-a", name: "x", values: {} }),
    () => P.applyPreset({ scope: "session", sid: "sess-a", id: "p-nope" }),
    () => P.deletePreset({ scope: "session", sid: "sess-a", id: "p-nope" }),
  ];
  let threw = 0;
  for (const run of bad) { try { await run(); } catch { threw += 1; } }
  ok(threw === bad.length, "十个坏参数全被拒（" + threw + "）");
  const long = await P.savePreset({ scope: "all", name: "一二三四五六七八九十一二三四五六七八九十一二三四", values: { minTokens: 1 } });
  ok(long.presets.scopes.all.items[0].name.length <= 24, "超长档名截到 24 字");
  const kept = await P.savePreset({ scope: "all", name: "留下", values: { minTokens: 1, keepRounds: 0 } });
  ok(kept.presets.scopes.all.items.some((i) => i.name === "留下" && i.values.keepRounds === 1), "轮数下限兜到 1");
}

console.log("8. 坏文件不装死");
{
  writeFileSync(file, "{ 这不是 JSON");
  ok(P.presetsSnapshot("sess-a").scopes.session.items.length === 0, "坏文件按空处理");
  ok(Object.keys(P.presetLayerFor("sess-a")).length === 0, "生效层也空");
  const saved = await P.savePreset({ scope: "session", sid: "sess-a", name: "重来", values: { minTokens: 500 } });
  ok(saved.presets.scopes.session.items.length === 1, "坏文件被整份覆盖后可继续用");
}

console.log("9. 条数上限");
{
  for (let i = 0; i < 20; i += 1) await P.savePreset({ scope: "all", name: "档" + i, values: { minTokens: 100 + i } });
  let threw = "";
  try { await P.savePreset({ scope: "all", name: "第 21 个", values: { minTokens: 1 } }); } catch (error) { threw = error.message; }
  ok(threw.includes("最多存"), "超过上限就拒绝：" + threw);
  ok(P.presetsSnapshot("sess-a").scopes.all.items.length === 20, "上限 20 个");
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
