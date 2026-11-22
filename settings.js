/** 设置系统 */
import { existsSync, readFileSync } from "node:fs";
import { rename, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

/** 用户可调项。默认值与 1.1.1 的行为完全一致：不配置就一切照旧。 */
export const DEFAULTS = Object.freeze({
  minTokens: 20000, // 轮后小切的起点
  keepRounds: 3, // 原处保留的最近已结束工具轮数
  keepRoundTokens: 32000, // 云端收尾停止线
  pointerTokens: 0, // 0 = 跟随 chunkMax
  chunkMin: 1000, // 不够这一刀就不切
  chunkMax: 32000, // 一刀上限，等于卡片轨道
  bigGate: 650000, // 绝对停切线

minNetGain: 3000, // 净收益门槛：切掉 - 卡片 < 这个数就不切

burstCuts: 3, // 一次收尾最多连切几刀（小刀；非 drain 会话以前只切一刀）

deepCutAbove: 0, // 中刀（卡片合并）默认关闭；>0 才启用，例如 200000

officialAbove: 0, // >0：超过这个 token 数且没有可切小段时，主动调一次官方大压缩（0 = 关）

officialCooldownMs: 1200000, // 两次大压缩之间至少隔 20 分钟

mergeBreakEven: 2, // 中刀盈亏平衡上限：一次性重算 / 每轮省下 超过这个倍数就不切

mergeMaxSpan: 4, // 中刀窗口 = chunkMax × 这个倍数（默认 4 = 128000）。0/1 退回旧的 chunkMax 上限

mergeCooldownMs: 300000, // 两刀中刀之间至少隔 5 分钟

paybackTurns: 0, // >0：一刀的一次性重算 > netGain × 这个轮数就不切（0 = 关，与上游正刀一致）

spanBandRatio: 0, // >0：单刀上限 = 上下文 × 比例，再夹进 chunkMin..chunkMax（0 = 关）

strictHostContext: 0, // 1 = 退回旧行为，把宿主注入的上下文快照也当成用户墙（默认 0：它们不是用户的话）
  cooldownMs: 0, // 0 = 只用 seq 一次性跳过
});

/** 旧的环境变量仍然有效，但只作为 config 缺席时的兜底。 */
export const ENV = Object.freeze({
  minTokens: "SPINE_MIN_TOKENS",
  keepRounds: "SPINE_KEEP_ROUNDS",
  keepRoundTokens: "SPINE_KEEP_ROUND_TOKENS",
  pointerTokens: "SPINE_POINTER_TOKENS",
  chunkMin: "SPINE_CHUNK_MIN",
  chunkMax: "SPINE_CHUNK_MAX",
  cooldownMs: "SPINE_COOLDOWN_MS",

bigGate: "SPINE_BIG_GATE",

minNetGain: "SPINE_MIN_NET_GAIN",

burstCuts: "SPINE_BURST_CUTS",

deepCutAbove: "SPINE_DEEP_CUT_ABOVE",

officialAbove: "SPINE_OFFICIAL_ABOVE",

officialCooldownMs: "SPINE_OFFICIAL_COOLDOWN_MS",

mergeBreakEven: "SPINE_MERGE_BREAK_EVEN",

mergeMaxSpan: "SPINE_MERGE_MAX_SPAN",

mergeCooldownMs: "SPINE_MERGE_COOLDOWN_MS",

paybackTurns: "SPINE_PAYBACK_TURNS",

spanBandRatio: "SPINE_SPAN_BAND_RATIO",

strictHostContext: "SPINE_STRICT_HOST_CONTEXT",
});

// volatile 字段的现值是 cosmokit 的取值对象，读之前先摊平。
const plain = (value) => (value && typeof value === "object" && typeof value.get === "function" ? value.get() : value);

/** 预设加载时取得独立快照；未配置的 volatile 引用不能覆盖较低优先级的值。 */
export function configSnapshot(config = {}) {
  return Object.fromEntries(Object.entries(config ?? {}).flatMap(([key, value]) => {
    const current = plain(value);
    return current == null ? [] : [[key, current]];
  }));
}

export const ENGINE_DEFAULTS = Object.freeze({
  auto: true,
  thresholdRatio: 0.8,
  headroomTokens: 65536,
  retainTokens: 8192,
  compactionRetries: 0,
});

const ENGINE_ENV = Object.freeze({
  thresholdRatio: "SPINE_THRESHOLD_RATIO",
  headroomTokens: "SPINE_HEADROOM_TOKENS",
  retainTokens: "SPINE_RETAIN_TOKENS",
});
const PLUGIN_KEYS = new Set(["takeoverPresets", ...Object.keys(DEFAULTS)]);

/** 只剥离本插件字段；其余字段（包括未知键）交给实际安装的 stock 校验。 */
export function engineConfig(config = {}, env = process.env) {
  const next = {};
  for (const [key, value] of Object.entries(config ?? {})) {
    if (!PLUGIN_KEYS.has(key)) next[key] = plain(value);
  }
  for (const [key, fallback] of Object.entries(ENGINE_DEFAULTS)) {
    // retainRatio / retainTokens 是宿主互斥选项，不能用默认 token 数盖掉显式比例。
    if (key === "retainTokens" && next.retainRatio != null) continue;
    const envName = ENGINE_ENV[key];
    if (next[key] == null) next[key] = finite(envName ? env?.[envName] : undefined) ?? fallback;
  }
  return next;
}

const finite = (value) => {
  const source = plain(value);
  if (typeof source !== "number" && typeof source !== "string") return undefined;
  if (typeof source === "string" && !source.trim()) return undefined;
  const number = Number(source);
  return Number.isFinite(number) ? number : undefined;
};

/** 设置文件的唯一解析处：面板桥和引擎读同一份路径，谁都不能另写一套。 */
export function settingsFilePath() {
  try {
    return process.env.SPINE_SETTINGS_FILE || join(process.env.DSH_HOME || join(homedir(), ".dsh"), "spine-settings.json");
  } catch {
    return "";
  }
}

/** 文件层的原始值（只读；解析失败按空处理，坏文件不该让引擎起不来）。 */
export function readOverrides() {
  const file = settingsFilePath();
  if (!file || !existsSync(file)) return {};
  try {
    const raw = JSON.parse(readFileSync(file, "utf8"));
    return raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

/** 文件层设置：~/.dsh/spine-settings.json，优先级在显式 config 之下、环境变量之上。 */
function fileSettings() {
  return readOverrides();
}

export function readSettings(config = {}, env = process.env, layer = null) {
  const file = fileSettings();
  const next = {};
  for (const [key, fallback] of Object.entries(DEFAULTS)) {
    const envName = ENV[key];
    const numeric = (value) => {
      const number = finite(value);
      return key === "keepRounds" && (!Number.isInteger(number) || number < 1) ? undefined : number;
    };
    // 优先级：显式 config > 生效中的自定义档（会话 > 工作区 > 全部）> 文件 > 环境 > 默认。
    next[key] =
      numeric(config?.[key]) ?? numeric(layer?.[key]) ?? numeric(file?.[key]) ?? numeric(envName ? env?.[envName] : undefined) ?? fallback;
  }
  if (!next.pointerTokens) next.pointerTokens = next.chunkMax;
  return Object.freeze(next);
}

/**
 * 复用实际安装的 stock schema，保留宿主字段和校验，不修改原 schema。
 * 每个字段都要 .volatile()：宿主的设置界面只列出 volatile 字段，漏一个就整份表单不出现。
 * 数值字段不注入 schema 默认值，保留“未显式配置”的状态，运行时才解析环境变量和默认值。
 */
export function configSchema(z, stockSchema) {
  const count = (min) => z.number().step(1).min(min);
  const stockFields = stockSchema?.dict ?? {
    auto: z.boolean(),
    thresholdRatio: z.number(),
    headroomTokens: count(0),
    retainTokens: count(0),
    compactionRetries: count(0),
  };
  return z.object({
    ...Object.fromEntries(Object.entries(stockFields).map(([key, field]) => [
      key, field.meta?.volatile ? field : z(field).volatile(),
    ])),
    takeoverPresets: z.union([z.boolean(), z.array(z.string())]).default(true)
      .description("接管官方预设中的压缩引擎；可填 false 或 preset ID 数组限制接管范围。修改后只影响新加载的预设，已有会话需重建。")
      .volatile(),
    minTokens: count(0)
      .description("轮后小切的起点，上下文到这个 token 数才切一刀。")
      .volatile(),
    keepRounds: count(1)
      .description("最近几个已结束的工具轮留在原文，至少 1 轮，默认 3。")
      .volatile(),
    keepRoundTokens: count(0)
      .description("云端收尾停止线，降到这个 token 数以下就不再切。")
      .volatile(),
    pointerTokens: count(0)
      .description("单个工具结果超过这个 token 数只留指针；0 = 跟随 chunkMax。")
      .volatile(),
    chunkMin: count(0)
      .description("一刀的最小量，不够就不切，避免每轮一张碎卡片。")
      .volatile(),
    chunkMax: count(1)
      .description("一刀的最大量，和卡片轨道同为 32000。")
      .volatile(),
    bigGate: count(1)
      .description("绝对停切线，超过就不再做小切，交给官方大压缩。")
      .volatile(),
    cooldownMs: count(0)
      .description("官方压缩之后跳过小切的时间窗；0 = 只按事件序号跳过一次。")
      .volatile(),
    minNetGain: count(0)
      .description("净收益门槛：切掉的量减去卡片剩余，不到这个数就不切。")
      .volatile(),
    burstCuts: count(1)
      .description("一次收尾最多连切几刀（小刀）。")
      .volatile(),
    deepCutAbove: count(0)
      .description("中刀（卡片合并）启用线：上下文超过这个 token 数才试；0 = 关闭。本地测试建议 120000~200000。")
      .volatile(),
    officialAbove: count(0)
      .description("大刀启用线：超过这个 token 数又没有可切小段时，主动请官方压一次；0 = 关闭。")
      .volatile(),
    officialCooldownMs: count(0)
      .description("两次大刀之间至少隔多少毫秒，默认 20 分钟。")
      .volatile(),
    mergeBreakEven: count(0)
      .description("中刀盈亏上限：一次性重算 / 净收益 超过这个倍数就不切。")
      .volatile(),
    mergeMaxSpan: count(0)
      .description("中刀窗口上限 = chunkMax × 这个倍数（默认 4，即 128000）。中刀要把卡片到切点整段重压，段太长就不出手；0 或 1 退回旧的 chunkMax 上限。")
      .volatile(),
    mergeCooldownMs: count(0)
      .description("两刀中刀之间的最小间隔毫秒。")
      .volatile(),
    paybackTurns: count(0)
      .description("动态限速：一刀的一次性重算超过 净收益×这个轮数 就不切；0 = 关闭（与上游正刀一致）。")
      .volatile(),
    spanBandRatio: count(0)
      .description("动态刀长：单刀上限 = 上下文 × 这个比例，夹在 chunkMin..chunkMax 之间；0 = 关闭。")
      .volatile(),
    strictHostContext: count(0)
      .description("0 = 宿主注入的上下文快照（时间/环境/技能目录）不算用户墙，小刀才切得动；1 = 退回旧行为。")
      .volatile(),
  });
}

const WRITE_KEYS = new Set(Object.keys(DEFAULTS));

/** 面板能写哪些键：只认引擎真会读的字段，别让人把配置文件写成杂物间。 */
export function isWritableKey(name) {
  return WRITE_KEYS.has(String(name));
}

/**
 * 写入文件层。patch 里值为 null 表示删掉这一项（回到 config / 环境 / 默认）。
 * 只收已声明的键和有限数字：面板再怎么错，也写不出引擎不认识的配置。
 * 先写 .tmp 再 rename：中途断电不会留下半个 JSON。
 */
export async function writeOverrides(patch = {}) {
  const file = settingsFilePath();
  if (!file) throw new Error("spine: no settings file path");
  const next = { ...readOverrides() };
  const changed = [];
  for (const [key, raw] of Object.entries(patch || {})) {
    if (!WRITE_KEYS.has(key)) throw new Error(`spine: unknown setting "${key}"`);
    if (raw === null || raw === undefined) {
      if (Object.prototype.hasOwnProperty.call(next, key)) { delete next[key]; changed.push(key); }
      continue;
    }
    const number = finite(raw);
    if (number === undefined || !Number.isFinite(number) || number < 0 || number > 1e7) {
      throw new Error(`spine: setting "${key}" must be a finite number between 0 and 10000000`);
    }
    next[key] = key === "keepRounds" ? Math.max(1, Math.round(number)) : number;
    changed.push(key);
  }
  if (!changed.length) return { file, overrides: next };
  const text = JSON.stringify(next, null, 2) + "\n";
  const temp = file + ".tmp";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await writeFile(temp, text, "utf8");
      await rename(temp, file);
      return { file, overrides: next };
    } catch (error) {
      if (attempt === 2) { try { await rm(temp, { force: true }); } catch {} throw error; }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  return { file, overrides: next };
}

/** 面板桥的 describe：生效值、文件值、默认值、以及被 profile 配置固定的字段。 */
export function describeSettings(config = {}, layer = null) {
  const overrides = readOverrides();
  const effective = readSettings(config, process.env, layer);
  const fromConfig = configSnapshot(config);
  const fixed = {};
  for (const key of Object.keys(DEFAULTS)) {
    if (fromConfig[key] !== undefined && fromConfig[key] !== null) fixed[key] = fromConfig[key];
  }
  return {
    file: settingsFilePath(),
    effective: { ...effective },
    overrides,
    defaults: { ...DEFAULTS },
    fixed,
  };
}

