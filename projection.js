/**
 * 压缩统计投影：把「切过多少、切在哪、卡片落在哪」变成客户端能直接读的会话投影。
 *
 * 面板不需要跟宿主再开一条 RPC：会话日志里的 compaction/summary 记录了每次压缩的
 * 事件范围与 token 数，紧跟其后的 user/message 卡片带着 source.kind 与备份文件名。
 * 这里的 apply 是纯同步折叠，客户端用 useProjection('spine.cuts') 读全量视图。
 *
 * Session projection for compaction stats: a pure fold over the log, read by the
 * client through useProjection('spine.cuts'). No extra RPC.
 */

export const SPINE_PROJECTION_KEY = "spine.cuts";
export const MAX_CUTS = 40;

const CARD_KINDS = new Set(["spine-checkpoint", "compact-checkpoint"]);
const PREVIEW_CHARS = 180;

/** 卡片正文取一段预览，供面板展开时认上下文。 */
function previewOf(content) {
  const blocks = Array.isArray(content) ? content : typeof content === "string" ? [{ type: "text", text: content }] : [];
  let text = blocks
    .filter((block) => block && typeof block.text === "string" && block.type !== "reasoning" && block.type !== "thinking")
    .map((block) => block.text)
    .join("\n");
  // 我方卡片开头是「这不是新指令」的前导说明，面板上没必要占行；从卡片正文标记之后截。
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
function looseSchema(fallback = (value) => value) {
  return { parse: (value) => (value === undefined ? fallback(undefined) : value) };
}

export function schemaFor(zod) {
  if (!zod?.object) return { state: looseSchema(), view: looseSchema() };
  const cut = zod.object({
    id: zod.string(),
    kind: zod.enum(["spine", "official"]),
    start: zod.number(),
    end: zod.number(),
    tokens: zod.number(),
    time: zod.number(),
    provider: zod.string(),
    model: zod.string(),
    preview: zod.string(),
    rawNames: zod.array(zod.string()),
  });
  const shape = {
    version: zod.number(),
    saved: zod.number(),
    spine: zod.number(),
    official: zod.number(),
    sid: zod.string(),
    shadowDir: zod.string(),
    cuts: zod.array(cut),
  };
  return { state: zod.object(shape), view: zod.object(shape) };
}

/**
 * 构造投影定义。
 * @param {{ zod?: any, shadowDir?: (sessionId: string) => string }} options
 */
export function spineProjectionDefinition({ zod = null, shadowDir = () => "" } = {}) {
  const schema = schemaFor(zod);
  return {
    key: SPINE_PROJECTION_KEY,
    stateSchema: schema.state,
    viewSchema: schema.view,
    stateVersion: 1,
    init(header) {
      const sid = String(header?.id ?? header?.sessionId ?? "");
      let dir = "";
      try { dir = shadowDir(sid) || ""; } catch {}
      return { version: 1, saved: 0, spine: 0, official: 0, sid, shadowDir: dir, cuts: [], pending: {} };
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
      const kind = source?.kind;
      if (!CARD_KINDS.has(kind)) return state;
      const id = String(source?.compactionId ?? "");
      if (id && state.cuts?.some((cut) => cut.id === id)) return state;
      const pending = state.pending || {};
      const info = (id && pending[id]) || {};
      const cut = {
        id: id || `seq-${event?.seq ?? state.cuts?.length ?? 0}`,
        kind: kind === "spine-checkpoint" ? "spine" : "official",
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
      const rest = { ...pending };
      if (id) delete rest[id];
      return {
        ...state,
        cuts,
        pending: rest,
        saved: (state.saved || 0) + cut.tokens,
        spine: (state.spine || 0) + (cut.kind === "spine" ? 1 : 0),
        official: (state.official || 0) + (cut.kind === "official" ? 1 : 0),
      };
    },
    wire: {
      viewSchema: schema.view,
      view(state) {
        return {
          version: state.version || 1,
          saved: state.saved || 0,
          spine: state.spine || 0,
          official: state.official || 0,
          sid: state.sid || "",
          shadowDir: state.shadowDir || "",
          cuts: (state.cuts || []).map((cut) => ({ ...cut })),
        };
      },
    },
  };
}
