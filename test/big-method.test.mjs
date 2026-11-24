/**
 * 大刀的「归纳器」分流：官方模型 vs 本地脚本。
 *
 * 用户选了脚本就必须只走脚本（零模型调用），坏卡要报错而不是悄悄回退到模型——
 * 否则「1 = 本地脚本」既省不了钱，也骗了人。这里把四条硬约束钉死：
 *   1) 默认（officialScript=0）走 super.summarize
 *   2) officialScript=1 绝不调 super
 *   3) 两条路吃的是同一份 input.messages
 *   4) 坏卡 / 空文本直接抛错，不回退
 *
 * 跑法：node --experimental-loader ./test/host-loader.mjs test/big-method.test.mjs
 */
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

// 宿主的 compression-basic 是替身（test/host-stub.mjs）：这里给它补一个可观测的
// summarize，super.summarize 才会在调用时落到它上面。
const host = await import("@deepseek-ai/dsh-compaction-basic");
const hostCalls = [];
host.BasicCompactionEngine.prototype.summarize = async function summarize(input) {
  hostCalls.push(input);
  return { summary: [{ type: "text", text: "OFFICIAL-SUMMARY" }], provider: "host", model: "host-model", rawOutput: [] };
};

// 临时目录：优先系统 tmp；某些沙箱不给写 os.tmpdir()（EPERM），退回当前工作目录。
const scratch = (() => {
  for (const root of [tmpdir(), process.cwd()]) {
    try { return mkdtempSync(join(root, "big-method-")); } catch {}
  }
  throw new Error("big-method: no writable scratch directory");
})();
const work = scratch;
process.env.DSH_HOME = join(work, ".dsh");
process.env.SPINE_SETTINGS_FILE = join(work, "spine-settings.json");
process.env.SPINE_SWITCH_FILE = join(work, "spine-switch.json");
delete process.env.SPINE_OFFICIAL_SCRIPT;

const { default: Engine } = await import("../index.js");

let pass = 0, fail = 0;
const ok = (c, n, x = "") => { if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + " " + x); } };

const quiet = { debug() {}, info() {}, warn() {}, error() {} };
function makeEngine(config = {}) {
  const ctx = {
    logger: quiet,
    tokenMeter: { estimateMessage: () => 1000 },
    effect: (fn) => (typeof fn === "function" ? fn() : () => {}),
    on: () => () => {},
    registry: { values: () => [] },
  };
  return new Engine(ctx, config);
}

/**
 * 一份典型的大刀输入：用户约束 + 一条助手结论 + 一条很长的工具输出。
 *
 * 工具输出必须真的长：大刀吃的是几十 k 起步的整段，只有这种情况下卡片才会
 * 明显短于原文（「卡片不能比原文长」是硬约束，几十个字符的假输入本来就过不去）。
 */
function bigInput() {
  const longTail = Array.from({ length: 400 }, (_v, i) => "row " + i + " value=" + i * 7).join("\n");
  return {
    messages: [
      { role: "user", content: [{ type: "text", text: "必须保留 export 字段，不要动上游适配层。" }], seq: 101, time: 1795500000000 },
      {
        role: "assistant",
        content: [{ type: "text", text: "根因是 adapter.js 少了 ./package.json 导出。\n已修复：补上导出并重装。" }],
        seq: 102, time: 1795500030000,
      },
      {
        role: "tool",
        content: [{ type: "text", text: "PASS 634 tests, 0 failed\nwrote src/index.js\n" + longTail }],
        seq: 103, time: 1795500060000, toolCallId: "call_big_1",
      },
    ],
  };
}
const agent = { session: { id: "session-big-method" } };

console.log("1. 默认档（officialScript 缺省 = 0）走官方模型");
{
  hostCalls.length = 0;
  const engine = makeEngine({});
  const input = bigInput();
  const result = await engine.summarizeOfficial(input, agent, undefined);
  ok(engine.settingsFor(agent).officialScript === 0, "默认值是 0（官方模型）");
  ok(hostCalls.length === 1, "super.summarize 被调了一次（" + hostCalls.length + "）");
  ok(hostCalls[0] === input, "交给 super 的就是同一份 input 对象");
  ok(result.provider === "host" && result.summary[0].text === "OFFICIAL-SUMMARY", "返回的是官方摘要，不是本地卡片");
  ok(result.model !== "spine-extract", "默认档的 model 不是本地脚本的 spine-extract（" + result.model + "）");
}

console.log("2. 脚本档（officialScript=1）绝不调 super");
{
  hostCalls.length = 0;
  const engine = makeEngine({ officialScript: 1 });
  const result = await engine.summarizeOfficial(bigInput(), agent, undefined);
  ok(engine.settingsFor(agent).officialScript === 1, "settingsFor 读到 1");
  ok(hostCalls.length === 0, "一次 super.summarize 都没有（" + hostCalls.length + "）——零模型调用");
  ok(Array.isArray(result.summary) && result.summary.length === 1 && result.summary[0].type === "text", "返回一个 text 摘要块");
  ok(result.provider === "local" && result.model === "spine-extract", "provider=local / model=spine-extract（" + result.provider + "/" + result.model + "）");
  ok(Array.isArray(result.rawOutput) && result.rawOutput[0] === result.summary[0], "rawOutput 与 summary 同一块");
  const text = result.summary[0].text;
  ok(text.startsWith("Spine extract."), "正文是我方卡片标记：" + text.slice(0, 24));
  ok(text.includes("必须保留 export 字段"), "用户约束被搬进卡片（硬事实）");
  ok(text.includes("PASS 634 tests"), "工具输出被搬进卡片");
  ok(text.includes("根因是 adapter.js"), "助手结论被转写进卡片");
  ok(text.includes("截于 ") && /\d{4}-\d{2}-\d{2} \d{2}:\d{2}/.test(text), "用到 spans 的 time 打时间戳：" + (text.match(/截于[^。]*/) || [""])[0]);
  ok(text.includes("seq 103"), "用到 spans 的 seq 写回读位置");
}

console.log("3. 两条路吃的是同一份 input.messages");
{
  const input = bigInput();
  hostCalls.length = 0;
  const official = await makeEngine({}).summarizeOfficial(input, agent, undefined);
  const hostSeen = hostCalls[0];
  hostCalls.length = 0;
  const local = await makeEngine({ officialScript: 1 }).summarizeOfficial(input, agent, undefined);
  ok(hostSeen === hostSeen && hostSeen === input, "官方路径拿到的就是 input 本身");
  ok(hostCalls.length === 0, "脚本路径一次模型都没调");
  ok(official.summary[0].text !== local.summary[0].text, "两条路产出不同（官方摘要 vs 本地卡片）");
  // 同一份 messages：脚本卡片里能逐条找到官方路径也收到的那几条正文
  const localText = local.summary[0].text;
  for (const message of input.messages) {
    const body = message.content.map((block) => block.text).join("\n");
    const firstLine = body.split("\n")[0].slice(0, 16);
    ok(localText.includes(firstLine), "脚本卡片包含同一条输入的正文片段：" + firstLine);
  }
  ok(input.messages.length === 3 && input.messages.every((m) => m.seq), "输入本身没有被改写（三条都在，seq 都在）");
}

console.log("4. 坏卡 / 空文本拒绝，且不回退模型");
{
  hostCalls.length = 0;
  const engine = makeEngine({ officialScript: 1 });
  let error = null;
  try {
    await engine.summarizeOfficial({ messages: [] }, agent, undefined);
  } catch (thrown) { error = thrown; }
  ok(error instanceof Error && /no messages/i.test(error.message), "空 messages 直接抛错：" + (error && error.message));
  ok(hostCalls.length === 0, "抛错时也没有偷偷回退到官方模型（" + hostCalls.length + "）");

  // 只有空文本的输入：卡片不可能是「比原文短且有内容」的，必须拒绝
  hostCalls.length = 0;
  let blank = null;
  try {
    await engine.summarizeOfficial({ messages: [{ role: "user", content: [{ type: "text", text: "" }] }] }, agent, undefined);
  } catch (thrown) { blank = thrown; }
  ok(blank instanceof Error, "只有空文本时拒绝出卡：" + (blank && blank.message));
  ok(hostCalls.length === 0, "空文本也没有回退模型");

  // 卡片不完整（缺硬事实）时也拒绝，而不是交出一张缺事实的卡。
  // 一条 4 万字符的用户「必须保留」行装不进任何 Kept 预算 -> buildCard.ok=false。
  hostCalls.length = 0;
  const huge = "必须保留 " + "x".repeat(40000);
  let incomplete = null;
  try {
    await engine.summarizeOfficial({ messages: [{ role: "user", content: [{ type: "text", text: huge }], seq: 1, time: 1795500000000 }] }, agent, undefined);
  } catch (thrown) { incomplete = thrown; }
  ok(incomplete instanceof Error && /incomplete card/i.test(incomplete.message), "缺硬事实的坏卡直接抛错：" + (incomplete && incomplete.message));
  ok(hostCalls.length === 0, "坏卡也没有回退到官方模型（" + hostCalls.length + "）");
}

console.log("5. 环境变量 SPINE_OFFICIAL_SCRIPT 能顶默认值");
{
  delete process.env.SPINE_OFFICIAL_SCRIPT;
  const a = makeEngine({}).settingsFor(agent).officialScript;
  process.env.SPINE_OFFICIAL_SCRIPT = "1";
  const b = makeEngine({}).settingsFor(agent).officialScript;
  delete process.env.SPINE_OFFICIAL_SCRIPT;
  ok(a === 0, "没有环境变量时默认 0");
  ok(b === 1, "SPINE_OFFICIAL_SCRIPT=1 时读成 1（" + b + "）");
  hostCalls.length = 0;
  process.env.SPINE_OFFICIAL_SCRIPT = "1";
  const viaEnv = await makeEngine({}).summarizeOfficial(bigInput(), agent, undefined);
  delete process.env.SPINE_OFFICIAL_SCRIPT;
  ok(hostCalls.length === 0 && viaEnv.provider === "local", "只靠环境变量也能切到本地脚本（零模型调用）");
}

console.log("6. 总开关关闭时忽略 officialScript，完全交回官方模型");
{
  writeFileSync(process.env.SPINE_SWITCH_FILE, JSON.stringify({ enabled: false, disabled: [] }));
  hostCalls.length = 0;
  const engine = makeEngine({ officialScript: 1 });
  const result = await engine.summarizeOfficial(bigInput(), agent, undefined);
  ok(hostCalls.length === 1, "总开关关闭时仍调用官方模型（" + hostCalls.length + "）");
  ok(result.provider === "host", "不返回本地脚本卡");
  writeFileSync(process.env.SPINE_SWITCH_FILE, JSON.stringify({ enabled: true, disabled: [] }));
}

rmSync(work, { recursive: true, force: true });
console.log("\n通过 " + pass + " / 失败 " + fail);
if (fail) process.exitCode = 1;
