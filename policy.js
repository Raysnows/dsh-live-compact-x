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
  const rewriteTokens = Math.max(0, (Number(totalTokens) || 0) - (Number(prefixTokens) || 0));
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
