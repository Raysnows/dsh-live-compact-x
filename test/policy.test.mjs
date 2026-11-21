import { spanCapFor, cutPolicy, lastPolicyVerdict, resetPolicyVerdict } from "../policy.js";
import { readSettings } from "../settings.js";

let pass = 0, fail = 0;
const ok = (c, n, extra = "") => {
  if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + " " + extra); }
};

console.log("1. 动态刀长：默认关闭时等于常量 chunkMax");
{
  const base = { chunkMin: 1000, chunkMax: 32000, spanBandRatio: 0 };
  ok(spanCapFor({ totalTokens: 900000, settings: base }) === 32000, "ratio=0 -> 32000");
  ok(spanCapFor({ totalTokens: 900000, settings: {} }) === 32000, "空设置 -> 32000");
}
console.log("2. 动态刀长：按上下文比例收放");
{
  const settings = { chunkMin: 1000, chunkMax: 32000, spanBandRatio: 0.06 };
  ok(spanCapFor({ totalTokens: 500000, settings }) === 30000, "500k * 0.06 = 30000");
  ok(spanCapFor({ totalTokens: 60000, settings }) === 3600, "60k * 0.06 = 3600");
  ok(spanCapFor({ totalTokens: 10000, settings }) === 1000, "太小 -> 夹到 chunkMin");
  ok(spanCapFor({ totalTokens: 2000000, settings }) === 32000, "太大 -> 夹到 chunkMax");
  ok(spanCapFor({ totalTokens: 500000, settings: { ...settings, chunkMax: 8000 } }) === 8000, "chunkMax 更小时以它为上限");
}
console.log("3. 回本门槛：默认关闭 = 上游行为");
{
  const settings = { paybackTurns: 0 };
  const v = cutPolicy({ totalTokens: 500000, spanTokens: 30000, cardTokens: 2500, prefixTokens: 200000, settings });
  ok(v.allow === true, "paybackTurns=0 一律放行");
  ok(v.netGain === 27500, "netGain = span - card = " + v.netGain);
  ok(v.rewriteTokens === 300000, "rewrite = total - prefix = " + v.rewriteTokens);
}
console.log("4. 回本门槛：赔本的刀要挡住");
{
  const settings = { paybackTurns: 3 };
  const blocked = cutPolicy({ totalTokens: 500000, spanTokens: 30000, cardTokens: 2500, prefixTokens: 200000, settings });
  ok(blocked.allow === false, "重算 300k / 净赚 27.5k，3 轮赚不回 -> 不切");
  ok(Math.abs(blocked.payback - 10.91) < 0.01, "回本轮数 " + blocked.payback);
  const cheap = cutPolicy({ totalTokens: 500000, spanTokens: 30000, cardTokens: 2500, prefixTokens: 470000, settings });
  ok(cheap.allow === true, "重算 30k / 净赚 27.5k -> 1.09 轮，允许");
}
console.log("5. 回本门槛：边界与异常输入");
{
  const settings = { paybackTurns: 2 };
  const exact = cutPolicy({ totalTokens: 100000, spanTokens: 20000, cardTokens: 0, prefixTokens: 60000, settings });
  ok(exact.allow === true, "重算恰好 = 净收益*2 时放行（大于才挡）");
  const zero = cutPolicy({ totalTokens: 100000, spanTokens: 1000, cardTokens: 1000, prefixTokens: 0, settings });
  ok(zero.allow === true, "净收益为 0 不触发门槛（交给 minNetGain 管）");
  const empty = cutPolicy({});
  ok(empty.allow === true && empty.rewriteTokens === 0, "空入参不抛错");
}
console.log("6. 判定结果可供日志读取");
{
  resetPolicyVerdict();
  ok(lastPolicyVerdict() === null, "reset 之后为空");
  cutPolicy({ totalTokens: 100000, spanTokens: 5000, cardTokens: 500, prefixTokens: 0, settings: { paybackTurns: 1 } });
  ok(lastPolicyVerdict()?.allow === false, "最近一次判定 = 挡住");
  resetPolicyVerdict();
}
console.log("7. 设置里两个新旋钮默认值 = 关闭（与上游一致）");
{
  process.env.SPINE_SETTINGS_FILE = "D:\\deepseek-workspaces\\work\\tmp\\no-such-spine.json";
  const s = readSettings({});
  ok(s.paybackTurns === 0, "paybackTurns 默认 0");
  ok(s.spanBandRatio === 0, "spanBandRatio 默认 0");
  const on = readSettings({ paybackTurns: "4", spanBandRatio: "0.05" });
  ok(on.paybackTurns === 4 && on.spanBandRatio === 0.05, "字符串也能解析");
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);
