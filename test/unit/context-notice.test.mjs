import { hostContextNotice, HOST_CONTEXT_KINDS } from "../../src/engine/notice.js";
import { selectCutIndexes } from "../../src/engine/plan.js";

let pass = 0, fail = 0;
const ok = (c, n, extra = "") => {
  if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + " " + extra); }
};
const ev = (source) => ({ type: "user/message", data: { role: "user", content: [], source } });

console.log("1. 宿主的七种注入都认");
{
  const cases = [
    ["time-context", "snapshot"], ["runtime-context", "snapshot"], ["skill-catalog", "catalog"],
    ["subagent-settled", "notice"], ["tool-jobs", "notice"], ["verify-gate", undefined], ["ptc-mode", undefined],
  ];
  for (const [kind, form] of cases) {
    const src = form ? { kind, form } : { kind };
    ok(hostContextNotice(ev(src), src) === true, kind + (form ? " / " + form : " / 无 form"));
  }
  ok(HOST_CONTEXT_KINDS.size === 7, "白名单七种");
}

console.log("2. 真人消息与审批仍是墙");
{
  const u = { kind: "user", rpcId: "x" };
  ok(hostContextNotice(ev(u), u) === false, "kind=user 不认");
  const ap = { kind: "user-approval" };
  ok(hostContextNotice(ev(ap), ap) === false, "user-approval 不认（保守）");
}

console.log("3. 未知来源与伪造 form 一律不认");
{
  const un = { kind: "mystery-plugin", form: "notice" };
  ok(hostContextNotice(ev(un), un) === false, "未知 kind 不认");
  const wf = { kind: "time-context", form: "user" };
  ok(hostContextNotice(ev(wf), wf) === false, "kind 对但 form 不对不认");
  ok(hostContextNotice(ev({}), {}) === false, "空 source 不认");
  ok(hostContextNotice(ev(undefined), undefined) === false, "source 缺失不认");
  ok(hostContextNotice({ type: "tool/result" }, { kind: "ptc-mode" }) === false, "非 user 事件不认");
}

console.log("4. 复现「一次没压」：切点落在最新那条注入左边");
{
  const build = (snapshotIsBoundary) => {
    const items = [{ type: "user", isGenuineUserBoundary: true, tokens: 500 }];
    for (let i = 0; i < 39; i++) items.push({ type: "tool", tokens: 900 });
    items.push({ type: "user", isGenuineUserBoundary: snapshotIsBoundary, tokens: 240 });
    for (let i = 0; i < 3; i++) items.push({ type: "tool", tokens: 700 });
    items.push({ type: "assistant", tokens: 400 });
    return items;
  };
  const opts = { engine: "local", chunkMin: 1000, chunkMax: 32000, pointerMax: 32000, maxEnd: 39, totalTokens: 253417, drain: false };
  ok(selectCutIndexes(build(true), opts) === null, "旧规则：注入当墙 -> 无合法段");
  const fixed = selectCutIndexes(build(false), opts);
  ok(Boolean(fixed) && fixed.tokens > 0, "新规则：切出 " + (fixed ? fixed.tokens : 0) + " tokens");
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
