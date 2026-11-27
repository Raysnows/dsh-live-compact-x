/**
 * 压缩统计投影：把「切过多少、切在哪、哪把刀切的、卡片落在哪」变成客户端能直接读的
 * 会话投影，面板不用再跟宿主开通道。
 *
 * 会话日志里的 compaction/summary 记录每次压缩的事件范围与 token 数；紧跟其后的
 * user/message 卡片带着 source.kind（我方 / 官方）与 source.knife（小刀 / 中刀）。
 * 这里的 apply 是纯同步折叠。
 *
 * Session projection for compaction stats: a pure fold over the log, read by the
 * client through useProjection('spine.cuts').
 */

import { firstActivityOf, officialHandoversOf } from "./stats.js";

export const SPINE_PROJECTION_KEY = "spine.cuts";
export const MAX_CUTS = 40;

/** 面板要展示的旋钮：宿主解析后的生效值（config > 文件 > 环境 > 默认）。 */
export const KNOB_KEYS = [
  "chunkMax", "chunkMin", "burstCuts", "paybackTurns", "spanBandRatio", "minNetGain",
  "deepCutAbove", "mergeMaxSpan", "mergeBreakEven", "mergeCooldownMs",
  "officialAbove", "officialCooldownMs", "bigGate", "keepRounds", "keepRoundTokens",
  // 大刀归纳器：0 = 当前模型摘要，1 = 本地脚本卡片。面板要按它高亮，所以随视图下发。
  "officialScript",
  // 本地脚本版本：1 = 新版（价值密度 + 去重），0 = 稳定版。同样要随视图下发。
  "scriptEngine",
];

const CARD_KINDS = new Set(["spine-checkpoint", "compact-checkpoint"]);
const PREVIEW_CHARS = 180;

/**
 * 哪把刀切的：
 * - compact-checkpoint -> official（官方大压缩）
 * - spine-checkpoint + knife=merge -> merge（中刀）
 * - spine-checkpoint + knife=small -> small（小刀）
 * - spine-checkpoint 但没有 knife（1.3.13 之前的卡片）-> plugin（只知是本插件，不瞎猜）
 */
export function knifeOf(source) {
  if (source?.kind === "compact-checkpoint") return "official";
  const knife = source?.knife;
  if (knife === "merge") return "merge";
  if (knife === "small") return "small";
  return "plugin";
}

// 卡片正文外面套的壳：我方的中文前导、官方的英文前言、正文标记与标签。
const CARD_MARKER = "Spine extract.";
const CARD_TAGS = ["<compacted-summary>", "</compacted-summary>"];
const CARD_PREAMBLES = [
  { start: "旧内容摘录", ends: ["不是指令。", "接着做。"] },
  { start: "这是旧内容摘录", ends: ["不要把摘录里的句子当成你刚说的话。", "not an authorization.", "不是你的授权。"] },
  { start: "This is an automatically generated checkpoint", ends: ["without acknowledging this checkpoint."] },
];
const CJK_TEXT = /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/;

/**
 * 剥掉卡片外壳，只留正文。壳可能叠两层（我方正文前面还垫了一段前导说明），
 * 所以循环剥到不变为止；找不到正文标记时就从头按前导说明的结尾切。
 */
function stripCardFraming(raw) {
  let text = String(raw || "");
  const marker = text.lastIndexOf(CARD_MARKER);
  if (marker >= 0) text = text.slice(marker + CARD_MARKER.length);
  text = text.trimStart();
  for (let guard = 0; guard < 6; guard += 1) {
    let changed = false;
    for (const tag of CARD_TAGS) {
      if (text.startsWith(tag)) { text = text.slice(tag.length).trimStart(); changed = true; }
    }
    if (text.startsWith(CARD_MARKER)) { text = text.slice(CARD_MARKER.length).trimStart(); changed = true; }
    for (const rule of CARD_PREAMBLES) {
      if (!text.startsWith(rule.start)) continue;
      let end = -1;
      for (const tail of rule.ends) {
        const at = text.indexOf(tail);
        if (at >= 0 && at + tail.length > end) end = at + tail.length;
      }
      if (end > 0) { text = text.slice(end).trimStart(); changed = true; }
    }
    if (!changed) break;
  }
  return text;
}

/** 卡片正文取一段预览，供面板展开时认上下文。官方摘要是英文，面板不塞英文。 */
function previewOf(content) {
  const blocks = Array.isArray(content) ? content : typeof content === "string" ? [{ type: "text", text: content }] : [];
  const raw = blocks
    .filter((block) => block && typeof block.text === "string" && block.type !== "reasoning" && block.type !== "thinking")
    .map((block) => block.text)
    .join("\n");
  const text = stripCardFraming(raw).replace(/\s+/g, " ").trim();
  // 开头一段没有汉字，说明是官方英文摘要：面板上留白，让客户端给一句中文说明。
  if (!CJK_TEXT.test(text.slice(0, 200))) return "";
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

/**
 * 官方卡的三种来源，卡片上长得一模一样（都是 `compact-checkpoint`），只能靠别的信号分：
 *
 * 1. 宿主的 `/compact` 命令（`dsh-command-compact`）——卡片带 `source.sourceCommandId`；
 * 2. **宿主自己的压力/溢出触发**——直接落进 `super.compactIfNeeded`，什么标记都没有；
 * 3. 本插件请官方压（`official-handover`）——唯一算「大刀」的那种。
 *
 * 早先只用「卡片时间 >= 本会话首次活动」判定，把 1 和 2 也算成了大刀。现在的判据：
 *
 * - 带 `sourceCommandId` → 官方（1）；
 * - `officialAbove === 0` → 官方：大刀开关关着，插件不可能发起过（2）；
 * - 卡片时间能对上一个 `official-handover` 时间点 → 大刀（3）；
 * - 其余 → 官方（含摘要记录丢失、日志轮换掉的情况，宁可少认）。
 *
 * @param {number} time 卡片时间（ms）
 * @param {number} firstActivity 这条会话第一次被本插件碰到的毫秒数
 * @param {string} [sourceCommandId] 卡片的 `source.sourceCommandId`；非空 = 命令触发
 * @param {{ officialAbove?: number, handovers?: number[], now?: number }} [context]
 *   `officialAbove` 是当前生效的大刀启用线；`handovers` 是该会话 official-handover
 *   的毫秒时间点（升序）；`now` 用于测试注入。
 */
export function isOursOfficial(time, firstActivity, sourceCommandId = "", context = {}) {
  const at = Number(time) || 0;
  if (!at) return false;
  // 1) 命令触发（手动 /compact）不是我们请的官方压缩，永远是官方。
  if (String(sourceCommandId || "").length > 0) return false;
  // 2) 大刀开关关着：插件这一路根本不会跑，出现官方卡一定是宿主自己的。
  const gate = Number(context?.officialAbove);
  if (Number.isFinite(gate) && gate === 0) return false;
  // 3) 认领：卡片时间必须早于（或等于）某条 handover 记录，且差距在摘要耗时的
  //    合理范围内。记录写在 compactIfNeeded 返回之后，所以 handover 总是更晚。
  const handovers = Array.isArray(context?.handovers) ? context.handovers : [];
  for (const ts of handovers) {
    const when = Number(ts) || 0;
    if (!when) continue;
    if (at <= when && when - at <= HANDOVER_MATCH_MS) return true;
  }
  // 4) 没有 handover 记录能认领它：保守算官方。
  return false;
}

/** 卡片时间与 handover 记录之间允许的时差：官方摘要最坏要跑满 180 秒超时。 */
export const HANDOVER_MATCH_MS = 300000;

/**
 * 把原始 cuts 归成五类：小刀 / 中刀 / 大刀 / 官方 / 旧卡片。
 *
 * 一条 handover 记录只能认领一张卡：否则同一刀会被后面的卡片反复借用。
 * `firstActivity` 保留在签名里（调用方与测试仍在传），但判据已改为「能否被
 * handover 认领」——它对多种宿主自触发的官方压缩一视同仁。
 */
export function attributeCuts(cuts, firstActivity, context = {}) {
  const handovers = Array.isArray(context?.handovers) ? [...context.handovers].sort((a, b) => a - b) : [];
  const claimed = new Set();
  return (Array.isArray(cuts) ? cuts : []).map((cut) => {
    if (cut?.kind !== "official") return { ...cut };
    const at = Number(cut?.time) || 0;
    const mine = String(cut?.sourceCommandId || "").length === 0
      && isOursOfficial(at, firstActivity, cut?.sourceCommandId, { ...context, handovers: handovers.filter((ts) => !claimed.has(ts)) });
    if (!mine) return { ...cut };
    // 认领最匹配（时间差最小）的那条记录，避免一条记录被两张卡同时用掉。
    let best = -1;
    let bestGap = Infinity;
    for (const ts of handovers) {
      if (claimed.has(ts) || at > ts) continue;
      const gap = ts - at;
      if (gap <= HANDOVER_MATCH_MS && gap < bestGap) { best = ts; bestGap = gap; }
    }
    if (best >= 0) claimed.add(best);
    return { ...cut, kind: "big" };
  });
}

/** 视图侧计数：按归属后的 cuts 数，再把 40 刀上限之外的历史按官方补回来。 */
export function countCuts(state, cuts) {
  const kinds = { ...EMPTY_VIEW_COUNTERS };
  const savedBy = { ...EMPTY_VIEW_COUNTERS };
  for (const cut of cuts) {
    const kind = String(cut?.kind || "official");
    if (!(kind in kinds)) continue;
    kinds[kind] += 1;
    savedBy[kind] += Number(cut.tokens) || 0;
  }
  const rawOfficial = Number(state?.kinds?.official) || 0;
  const seen = kinds.big + kinds.official;
  if (rawOfficial > seen) {
    kinds.official += rawOfficial - seen;
    const rawSaved = Number(state?.savedBy?.official) || 0;
    const seenSaved = savedBy.big + savedBy.official;
    if (rawSaved > seenSaved) savedBy.official += rawSaved - seenSaved;
  }
  return { kinds, savedBy };
}

/** 最小 schema：宿主只调用 .parse()，不引 zod 也能注册；有 zod 就用真 zod。 */
function looseSchema() {
  return { parse: (value) => value };
}

export function schemaFor(zod) {
  if (!zod?.object) return { state: looseSchema(), view: looseSchema() };
  // 计数一律用宽松字典：刀法分类以后还会扩，缺键/多键都不该算坏数据。
  const counters = zod.record(zod.string(), zod.number());
  const viewCounters = counters;
  const cut = zod.object({
    id: zod.string(),
    // 不用 enum：刀法分类升级时，旧快照和新快照都不该把历史会话挡住。
    kind: zod.string(),
    start: zod.number(),
    end: zod.number(),
    tokens: zod.number(),
    time: zod.number(),
    provider: zod.string(),
    model: zod.string(),
    preview: zod.string(),
    // 旧快照没有这一项，必须可选，否则升级会把历史会话挡在门外。
    sourceCommandId: zod.string().optional(),
    rawNames: zod.array(zod.string()),
  });
  // 老快照缺字段也算合法：升级时宁可少显示，也别把历史会话挡在门外。
  const state = zod.object({
    version: zod.number(),
    saved: zod.number(),
    spine: zod.number(),
    official: zod.number(),
    sid: zod.string(),
    shadowDir: zod.string(),
    kinds: counters.optional(),
    savedBy: counters.optional(),
    cuts: zod.array(cut),
    pending: zod.record(zod.string(), zod.any()).optional(),
  });
  const knifeStat = zod.object({ cuts: zod.number(), tokens: zod.number(), saved: zod.number() });
  const globalShape = zod.object({
    generatedAt: zod.number(),
    since: zod.number(),
    sessions: zod.number(),
    knives: zod.record(zod.string(), knifeStat),
    firstBySid: zod.record(zod.string(), zod.number()).optional(),
    // 大刀认领表：每个会话 official-handover 的时间点。旧快照没有这一项。
    officialHandovers: zod.record(zod.string(), zod.array(zod.number())).optional(),
    attempts: zod.record(zod.string(), zod.number()).optional(),
  });
  const view = zod.object({
    global: globalShape.optional(),
    version: zod.number(),
    saved: zod.number(),
    spine: zod.number(),
    official: zod.number(),
    sid: zod.string(),
    shadowDir: zod.string(),
    kinds: viewCounters.optional(),
    savedBy: viewCounters.optional(),
    cuts: zod.array(cut),
    firstActivity: zod.number().optional(),
    settings: zod.record(zod.string(), zod.number()).optional(),
    defaults: zod.record(zod.string(), zod.number()).optional(),
    docs: zod.object({
      readme: zod.string(), repo: zod.string(), issues: zod.string(),
      changelog: zod.string(), version: zod.string(),
      readmeExists: zod.boolean().optional(), changelogExists: zod.boolean().optional(),
    }).optional(),
  });
  return { state, view };
}

const EMPTY_COUNTERS = { small: 0, merge: 0, plugin: 0, official: 0 };
const EMPTY_VIEW_COUNTERS = { small: 0, merge: 0, plugin: 0, big: 0, official: 0 };
const EMPTY_KNIFE = () => ({ cuts: 0, tokens: 0, saved: 0 });
const EMPTY_GLOBAL = () => ({
  generatedAt: 0,
  since: 0,
  sessions: 0,
  knives: { small: EMPTY_KNIFE(), merge: EMPTY_KNIFE(), big: EMPTY_KNIFE() },
  attempts: { cut: 0, cutSkip: 0, mergeSkip: 0, official: 0, failed: 0 },
  firstBySid: {},
});

/**
 * 构造投影定义。
 * @param {{ zod?: any, shadowDir?: (sid: string) => string, settingsReader?: () => Record<string, number>, docs?: Record<string, string>, version?: string }} options
 */
export function spineProjectionDefinition({
  zod = null, shadowDir = () => "", settingsReader = null, globalStatsReader = null, defaults = null, docs = {}, version = "",
} = {}) {
  const schema = schemaFor(zod);
  const docsValue = {
    readme: String(docs.readme || ""),
    repo: String(docs.repo || ""),
    issues: String(docs.issues || ""),
    changelog: String(docs.changelog || ""),
    version: String(version || docs.version || ""),
    // 探不到就是没有：面板据此把「打开」标成缺文件，而不是让人点出一句报错。
    readmeExists: docs.readmeExists === true,
    changelogExists: docs.changelogExists === true,
  };
  // 视图要复用引用（框架靠 Object.is 抑制发布）；设置变了才换新对象。
  let cachedView = null;
  let cachedStamp = "";
  const readKnobs = (sid) => {
    const out = {};
    let resolved = null;
    if (settingsReader) {
      try { resolved = settingsReader(sid || ""); } catch { resolved = null; }
    }
    const source = resolved || {};
    for (const key of KNOB_KEYS) {
      const value = Number(source[key]);
      out[key] = Number.isFinite(value) ? value : 0;
    }
    return out;
  };
  return {
    key: SPINE_PROJECTION_KEY,
    stateSchema: schema.state,
    viewSchema: schema.view,
    // 2：1.4.1 起 cuts 多了 sourceCommandId（手动 /compact 归因）；版本不符时宿主会整段重放。
    stateVersion: 2,
    init(header) {
      const sid = String(header?.id ?? header?.sessionId ?? "");
      let dir = "";
      try { dir = shadowDir(sid) || ""; } catch {}
      return {
        version: 1, saved: 0, spine: 0, official: 0, sid, shadowDir: dir,
        kinds: { ...EMPTY_COUNTERS }, savedBy: { ...EMPTY_COUNTERS }, cuts: [], pending: {},
      };
    },
    apply(state, event) {
      const type = event?.type;
      const data = event?.data;
      if (type === "compaction/summary") {
        const id = String(data?.compactionId ?? "");
        if (!id || state.pending?.[id]) return state;
        const range = data?.shadowedRange ?? {};
        const next = {
          start: Number(range.start) || 0,
          end: Number(range.end) || 0,
          tokens: Number(data?.shadowedTokenCount) || 0,
          provider: String(data?.provider ?? ""),
          model: String(data?.model ?? ""),
          time: Number(event?.time) || 0,
        };
        // summary 写了但卡片没落地的压缩（被中止）不能无限堆：只留最近 20 条挂起。
        const merged = { ...(state.pending || {}), [id]: next };
        const keys = Object.keys(merged);
        const pending = keys.length > 20
          ? Object.fromEntries(keys.slice(-20).map((key) => [key, merged[key]]))
          : merged;
        return { ...state, pending };
      }
      if (type !== "user/message") return state;
      const source = data?.source;
      if (!CARD_KINDS.has(source?.kind)) return state;
      const id = String(source?.compactionId ?? "");
      if (id && state.cuts?.some((cut) => cut.id === id)) return state;
      const pending = state.pending || {};
      const info = (id && pending[id]) || {};
      const kind = knifeOf(source);
      const cut = {
        id: id || `seq-${event?.seq ?? state.cuts?.length ?? 0}`,
        kind,
        start: Number(info.start) || 0,
        end: Number(info.end) || 0,
        tokens: Number(info.tokens) || 0,
        time: Number(info.time) || Number(event?.time) || 0,
        provider: String(info.provider ?? ""),
        model: String(info.model ?? ""),
        preview: previewOf(data?.content),
        // 命令触发的官方压缩（手动 /compact）靠它和「我们请的」区分开。
        sourceCommandId: String(source?.sourceCommandId ?? ""),
        rawNames: Array.isArray(source?.rawNames) ? source.rawNames.map((name) => String(name)) : [],
      };
      const cuts = [...(state.cuts || []), cut].slice(-MAX_CUTS);
      const kinds = { ...EMPTY_COUNTERS, ...(state.kinds || {}) };
      const savedBy = { ...EMPTY_COUNTERS, ...(state.savedBy || {}) };
      kinds[kind] = (Number(kinds[kind]) || 0) + 1;
      savedBy[kind] = (Number(savedBy[kind]) || 0) + cut.tokens;
      const rest = { ...pending };
      if (id) delete rest[id];
      const mine = kind === "small" || kind === "merge" || kind === "plugin";
      return {
        ...state,
        cuts,
        pending: rest,
        kinds,
        savedBy,
        saved: (state.saved || 0) + cut.tokens,
        spine: (state.spine || 0) + (mine ? 1 : 0),
        official: (state.official || 0) + (mine ? 0 : 1),
      };
    },
    wire: {
      viewSchema: schema.view,
      view(state) {
        const settings = readKnobs(state.sid);
        let global = EMPTY_GLOBAL();
        if (globalStatsReader) {
          try { global = globalStatsReader() || global; } catch { global = EMPTY_GLOBAL(); }
        }
        // 这条会话第一次被本插件碰到的时间：早于它的官方压缩算接管前的历史。
        const firstActivity = firstActivityOf(global, state.sid);
        // 大刀归属要靠「本插件请官方压过没有」：卡片上没有来源字段，
        // 只有决策日志里的 official-handover 时间点能认领。
        const handovers = officialHandoversOf(global, state.sid);
        const cuts = attributeCuts(state.cuts, firstActivity, {
          officialAbove: Number(settings.officialAbove) || 0,
          handovers,
        });
        const { kinds, savedBy } = countCuts(state, cuts);
        // 「默认档」要有默认值可填：把引擎的 DEFAULTS 一并下发，面板不猜。
        const knobDefaults = {};
        const source = defaults || {};
        for (const key of KNOB_KEYS) {
          const value = Number(source[key]);
          knobDefaults[key] = Number.isFinite(value) ? value : 0;
        }
        const stamp = JSON.stringify([settings, knobDefaults, global.generatedAt, global.sessions, global.knives, firstActivity, handovers, cuts.length]);
        if (cachedView && cachedStamp === stamp) return cachedView;
        cachedStamp = stamp;
        cachedView = {
          global,
          version: state.version || 1,
          saved: state.saved || 0,
          spine: state.spine || 0,
          official: kinds.official,
          sid: state.sid || "",
          shadowDir: state.shadowDir || "",
          kinds,
          savedBy,
          cuts,
          firstActivity,
          settings,
          defaults: knobDefaults,
          docs: docsValue,
        };
        return cachedView;
      },
    },
  };
}
