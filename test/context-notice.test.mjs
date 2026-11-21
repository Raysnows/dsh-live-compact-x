import { hostContextNotice, HOST_CONTEXT_KINDS } from "../notice.js";
import { selectCutIndexes } from "../plan.js";

let pass = 0, fail = 0;
const ok = (c, n, extra = "") => {
  if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + " " + extra); }
};
const userEvent = (source) => ({ type: "user/message", data: { role: "user", content: [], source } });

console.log("1. 宿主三种快照都认");
{
  ok(hostContextNotice(userEvent({ kind: "time-context", form: "snapshot" }), { kind: "time-context", form: "snapshot" }) === true, "time-context / snapshot");
  ok(hostContextNotice(userEvent({ kind: "runtime-context", form: "snapshot" }), { kind: "runtime-context", form: "snapshot" }) === true, "runtime-context / snapshot");
  ok(hostContextNotice(userEvent({ kind: "skill-catalog", form: "catalog" }), { kind: "skill-catalog", form: "catalog" }) === true, "skill-catalog / catalog");
  ok(HOST_CONTEXT_KINDS.size === 3, "白名单只有三种");
}

console.log("2. 未知来源一律不认（不能借道）");
{
  ok(hostContextNotice(userEvent({ kind: "mystery-plugin", form: "snapshot" }), { kind: "mystery-plugin", form: "snapshot" }) === false, "未知 kind 不认");
  ok(hostContextNotice(userEvent({ kind: "user", rpcId: "x" }), { kind: "user", rpcId: "x" }) === false, "真正的用户消息不认");
  ok(hostContextNotice(userEvent({ kind: "time-context", form: "user" }), { kind: "time-context", form: "user" }) === false, "form 不对不认");
  ok(hostContextNotice(userEvent({}), {}) === false, "空 source 不认");
  ok(hostContextNotice(userEvent(undefined), undefined) === false, "source 缺失不认");
}

console.log("3. 非用户事件不认");
{
  ok(hostContextNotice({ type: "tool/result", data: { source: { kind: "time-context", form: "snapshot" } } }, { kind: "time-context", form: "snapshot" }) === false, "tool/result 不认");
  ok(hostContextNotice(undefined, { kind: "time-context", form: "snapshot" }) === false, "空事件不认");
}

console.log("4. 复现「一次没压」：切点落在最新那条快照左边");
{
  // 形状取自实测：一个真实用户消息 + 一堆工具结果 + 宿主快照 + 最近 3 轮 + 收尾正文
  const build = (snapshotIsBoundary) => {
    const items = [{ type: "user", isGenuineUserBoundary: true, tokens: 500 }];
    for (let i = 0; i < 39; i++) items.push({ type: "tool", tokens: 900 });
    items.push({ type: "user", isGenuineUserBoundary: snapshotIsBoundary, tokens: 240 });
    for (let i = 0; i < 3; i++) items.push({ type: "tool", tokens: 700 });
    items.push({ type: "assistant", tokens: 400 });
    return items;
  };
  // 切点=快照前一个工具结果（keepRounds 保留最后 3 轮之后的位置）
  const limit = 39;
  const opts = { engine: "local", chunkMin: 1000, chunkMax: 32000, pointerMax: 32000, maxEnd: limit, totalTokens: 142909, drain: false };
  const oldWay = selectCutIndexes(build(true), opts);
  const newWay = selectCutIndexes(build(false), opts);
  ok(oldWay === null, "旧规则：快照当墙 -> 没有合法段（这就是 142k 没压的原因）");
  ok(newWay && newWay.start <= newWay.end, "新规则：快照不当墙 -> 切出 " + (newWay ? newWay.tokens : 0) + " tokens");
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
