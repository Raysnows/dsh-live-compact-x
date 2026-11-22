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

export const SPINE_PROJECTION_KEY = "spine.cuts";
export const MAX_CUTS = 40;

/** 面板要展示的旋钮：宿主解析后的生效值（config > 文件 > 环境 > 默认）。 */
export const KNOB_KEYS = [
  "chunkMax", "chunkMin", "burstCuts", "paybackTurns", "spanBandRatio", "minNetGain",
  "deepCutAbove", "mergeMaxSpan", "mergeBreakEven", "mergeCooldownMs",
  "officialAbove", "officialCooldownMs", "bigGate", "keepRounds", "keepRoundTokens",
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

/** 卡片正文取一段预览，供面板展开时认上下文。 */
function previewOf(content) {
  const blocks = Array.isArray(content) ? content : typeof content === "string" ? [{ type: "text", text: content }] : [];
  let text = blocks
    .filter((block) => block && typeof block.text === "string" && block.type !== "reasoning" && block.type !== "thinking")
    .map((block) => block.text)
    .join("\n");
  // 我方卡片开头是「这不是新指令」的前导说明，面板上没必要占行。
  // 旧版卡片不带标记，只带前导说明：按那句话的结尾切一刀。
  if (text.trimStart().startsWith("这是旧内容摘录")) {
    const sentinels = ["not an authorization.", "不要把摘录里的句子当成你刚说的话。", "不是你的授权。"];
    const end = sentinels.reduce((best, sentinel) => {
      const at = text.indexOf(sentinel);
      return at >= 0 && at + sentinel.length > best ? at + sentinel.length : best;
    }, -1);
    if (end > 0) text = text.slice(end);
  }
  const marker = text.lastIndexOf("Spine extract.");
  if (marker >= 0) text = text.slice(marker + "Spine extract.".length);
  text = text.replace(/\s+/g, " ").trim();
  return text.length > PREVIEW_CHARS ? `${text.slice(0, PREVIEW_CHARS)}…` : text;
}

/** 最小 schema：宿主只调用 .parse()，不引 zod 也能注册；有 zod 就用真 zod。 */
function looseSchema() {
  return { parse: (value) => value };
}

export function schemaFor(zod) {
  if (!zod?.object) return { state: looseSchema(), view: looseSchema() };
  const counters = zod.object({
    small: zod.number(), merge: zod.number(), plugin: zod.number(), official: zod.number(),
  });
  const cut = zod.object({
    id: zod.string(),
    kind: zod.enum(["small", "merge", "plugin", "official"]),
    start: zod.number(),
    end: zod.number(),
    tokens: zod.number(),
    time: zod.number(),
    provider: zod.string(),
    model: zod.string(),
    preview: zod.string(),
    rawNames: zod.array(zod.string()),
  });
  const state = zod.object({
    version: zod.number(),
    saved: zod.number(),
    spine: zod.number(),
    official: zod.number(),
    sid: zod.string(),
    shadowDir: zod.string(),
    kinds: counters,
    savedBy: counters,
    cuts: zod.array(cut),
    pending: zod.record(zod.string(), zod.any()).optional(),
  });
  const knifeStat = zod.object({ cuts: zod.number(), tokens: zod.number(), saved: zod.number() });
  const globalShape = zod.object({
    generatedAt: zod.number(),
    since: zod.number(),
    sessions: zod.number(),
    knives: zod.object({ small: knifeStat, merge: knifeStat, official: knifeStat }),
    attempts: zod.object({
      cut: zod.number(), cutSkip: zod.number(), mergeSkip: zod.number(), official: zod.number(), failed: zod.number(),
    }),
  });
  const view = zod.object({
    global: globalShape,
    version: zod.number(),
    saved: zod.number(),
    spine: zod.number(),
    official: zod.number(),
    sid: zod.string(),
    shadowDir: zod.string(),
    kinds: counters,
    savedBy: counters,
    cuts: zod.array(cut),
    settings: zod.record(zod.string(), zod.number()),
    docs: zod.object({
      readme: zod.string(), repo: zod.string(), issues: zod.string(),
      changelog: zod.string(), version: zod.string(),
    }),
  });
  return { state, view };
}

const EMPTY_COUNTERS = { small: 0, merge: 0, plugin: 0, official: 0 };
const EMPTY_KNIFE = () => ({ cuts: 0, tokens: 0, saved: 0 });
const EMPTY_GLOBAL = () => ({
  generatedAt: 0,
  since: 0,
  sessions: 0,
  knives: { small: EMPTY_KNIFE(), merge: EMPTY_KNIFE(), official: EMPTY_KNIFE() },
  attempts: { cut: 0, cutSkip: 0, mergeSkip: 0, official: 0, failed: 0 },
});

/**
 * 构造投影定义。
 * @param {{ zod?: any, shadowDir?: (sid: string) => string, settingsReader?: () => Record<string, number>, docs?: Record<string, string>, version?: string }} options
 */
export function spineProjectionDefinition({
  zod = null, shadowDir = () => "", settingsReader = null, globalStatsReader = null, docs = {}, version = "",
} = {}) {
  const schema = schemaFor(zod);
  const docsValue = {
    readme: String(docs.readme || ""),
    repo: String(docs.repo || ""),
    issues: String(docs.issues || ""),
    changelog: String(docs.changelog || ""),
    version: String(version || docs.version || ""),
  };
  // 视图要复用引用（框架靠 Object.is 抑制发布）；设置变了才换新对象。
  let cachedView = null;
  let cachedStamp = "";
  const readKnobs = () => {
    const out = {};
    let resolved = null;
    if (settingsReader) {
      try { resolved = settingsReader(); } catch { resolved = null; }
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
    stateVersion: 1,
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
        const settings = readKnobs();
        let global = EMPTY_GLOBAL();
        if (globalStatsReader) {
          try { global = globalStatsReader() || global; } catch { global = EMPTY_GLOBAL(); }
        }
        const stamp = JSON.stringify([settings, global.generatedAt, global.sessions, global.knives]);
        if (cachedView && cachedStamp === stamp) return cachedView;
        cachedStamp = stamp;
        cachedView = {
          global,
          version: state.version || 1,
          saved: state.saved || 0,
          spine: state.spine || 0,
          official: state.official || 0,
          sid: state.sid || "",
          shadowDir: state.shadowDir || "",
          kinds: { ...EMPTY_COUNTERS, ...(state.kinds || {}) },
          savedBy: { ...EMPTY_COUNTERS, ...(state.savedBy || {}) },
          cuts: (state.cuts || []).map((cut) => ({ ...cut })),
          settings,
          docs: docsValue,
        };
        return cachedView;
      },
    },
  };
}
