/**
 * 动态策略层（fork 新增，默认全部关闭 = 与上游正刀完全一致）。
 *
 * 上游正刀用的是常量：chunkMax=32000、minNetGain=3000。常量的问题是有时候
 * 一刀的「一次性重算」远大于它省下的量（实测 6 刀省 61,252，重算 330,365），
 * 单看 saved 很漂亮，实际是赔的。这里把「该切多大、值不值得切」变成函数：
 * 入参是当下的上下文规模、这一刀的净收益、切点之后的缓存重算量。
 *
 * Dynamic policy layer. Everything here is off by default, so the stock
 * knife behaves exactly as upstream. Turn it on per machine via
 * ~/.dsh/spine-settings.json (or the settings form).
 */

/** 未开启时导出常量，保证零行为变化。 */
export function spanCapFor({ totalTokens = 0, settings = {} } = {}) {
  const hi = Number(settings.chunkMax) || 32000;
  const ratio = Number(settings.spanBandRatio) || 0;
  if (!(ratio > 0)) return hi;
  const lo = Math.min(hi, Number(settings.chunkMin) || 1000);
  const target = Math.round((Number(totalTokens) || 0) * ratio);
  if (!(target > 0)) return lo;
  return Math.max(lo, Math.min(hi, target));
}

/**
 * 一笔账：这一刀省下的 netGain，要用几轮才能把「切点之后全部重算」的钱赚回来。
 * paybackTurns = 0 关闭；> 0 时超过这个轮数就不切。
 */
export function cutPolicy({ totalTokens = 0, spanTokens = 0, cardTokens = 0, prefixTokens = 0, settings = {} } = {}) {
  // 切点之后必须重算的是「新卡片 + 被切段之后剩下的内容」。被切掉的那一段已经不
  // 进请求了，不能算进重算面——旧版用 total - prefix 把省下的量又罚了一遍，
  // 253k 那笔账因此多算了 14k（64,144 里只有约 51k 是真的要重算）。
  const rewriteTokens = Math.max(0, (Number(totalTokens) || 0) - (Number(prefixTokens) || 0) - (Number(spanTokens) || 0))
    + Math.max(0, Number(cardTokens) || 0);
  const netGain = (Number(spanTokens) || 0) - (Number(cardTokens) || 0);
  const paybackTurns = Number(settings.paybackTurns) || 0;
  const payback = netGain > 0 ? rewriteTokens / netGain : Infinity;
  if (paybackTurns > 0 && netGain > 0 && rewriteTokens > netGain * paybackTurns) {
    lastVerdict = { allow: false, reason: "payback", payback: Number(payback.toFixed(2)), rewriteTokens, netGain, spanTokens, cardTokens };
    return lastVerdict;
  }
  lastVerdict = { allow: true, reason: "ok", payback: Number.isFinite(payback) ? Number(payback.toFixed(2)) : null, rewriteTokens, netGain, spanTokens, cardTokens };
  return lastVerdict;
}

/** 最近一次策略判定，给决策日志用（cut-skip 的 reason 会带上它）。 */
let lastVerdict = null;
export function lastPolicyVerdict() {
  return lastVerdict;
}
export function resetPolicyVerdict() {
  lastVerdict = null;
}

/**
 * 中刀（卡片合并 / 深切）候选。
 *
 * 卡片本身是墙：小刀只能在最新一张卡之后削，于是「头」永远削不动——长会话里
 * 前缀只会越堆越高（实测 253k 上下文里最新卡离切点还有 8 万 token）。中刀从
 * 某张旧卡起，把卡片连同中间内容重压成一张新卡。
 *
 * 关键在于「切点之后要重算多少」：切点越靠前，重算面越大。所以中刀必须一刀切到
 * 尾巴（切点是最后的保留轮），重算面最小——这正是它划算的原因。真正的限制是
 * 「这一段能有多长」，不是「重算面有多小」。
 *
 * The economics: the rewrite cost is everything to the right of the cut, so a
 * middle knife must cut all the way to the tail; the real limit is how long a
 * span we are willing to re-summarize, not how small the rewrite is.
 *
 * @param items     每条的 { tokens }（和 selectCutIndexes 同一份）
 * @param cards     卡片在 items 里的下标（升序、降序都行，内部不依赖顺序）
 * @param end       允许的最大切点下标（通常是小刀选出的切点）
 * @param spanCap   截断兜底时的单刀上限
 * @param hardCap   整窗上限（卡片 -> end 的整段超过它才退化成截断子段）
 * @param chunkMin  单刀下限，太短不值得重算缓存
 * @param startOk   起点是否合法（工具对成对）
 * @param stopOk    切点是否合法（工具对成对）
 * @param breakEven 一次性重算的容忍倍数，只用于排序打分
 */
export function mergeSpanCandidates({
  items = [],
  cards = [],
  end = -1,
  spanCap = 32000,
  hardCap = 0,
  chunkMin = 1000,
  startOk = () => true,
  stopOk = () => true,
  totalTokens = 0,
  breakEven = 0,
} = {}) {
  const min = Math.max(0, Number(chunkMin) || 0);
  const cap = Math.max(min, Number(spanCap) || 0);
  const hard = Math.max(cap, Number(hardCap) || 0);
  // 没开回本门槛时按 1 倍算，排序就变成「省得多、重算得少」。
  const weight = Number(breakEven) > 0 ? Number(breakEven) : 1;
  const out = [];
  const seen = new Set();
  const prefixOf = (startIndex) => {
    let prefix = 0;
    for (let index = 0; index < startIndex; index += 1) prefix += Number(items[index]?.tokens) || 0;
    return prefix;
  };
  const push = (startIndex, stop, spanTokens, kind) => {
    if (stop < 0 || spanTokens < min) return;
    const prefixTokens = prefixOf(startIndex);
    // 切点之后要重算的量：总量 - 前缀 - 被切掉的段（新卡片另由调用方加上）。
    const rewriteTokens = Math.max(0, (Number(totalTokens) || 0) - prefixTokens - spanTokens);
    out.push({
      startIndex,
      stop,
      spanTokens,
      prefixTokens,
      rewriteTokens,
      window: kind,
      // 卡片正文的成本要真压出来才知道，所以先用 span 的价值排序，调用方再复核。
      margin: spanTokens * weight - rewriteTokens,
    });
  };
  for (const startIndex of cards) {
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex > end) continue;
    if (seen.has(startIndex)) continue;
    seen.add(startIndex);
    if (!startOk(startIndex)) continue;
    // 首选整窗：卡片 -> end 整段压成一张卡，切点之后只剩保留轮，重算面最小。
    let toEnd = 0;
    for (let index = startIndex; index <= end; index += 1) toEnd += Number(items[index]?.tokens) || 0;
    if (stopOk(end) && toEnd <= hard) {
      push(startIndex, end, toEnd, "full");
      continue;
    }
    // 兜底：整窗太长，退化成从卡片往后长到 spanCap 的截断子段（代价是尾巴也要重算）。
    let acc = 0;
    let stop = -1;
    let stopTokens = 0;
    for (let index = startIndex; index <= end; index += 1) {
      const tokens = Number(items[index]?.tokens) || 0;
      if (acc + tokens > cap) break;
      acc += tokens;
      if (stopOk(index)) {
        stop = index;
        stopTokens = acc;
      }
    }
    push(startIndex, stop, stopTokens, "truncated");
  }
  out.sort((left, right) => (right.margin - left.margin) || (right.startIndex - left.startIndex));
  return out;
}
