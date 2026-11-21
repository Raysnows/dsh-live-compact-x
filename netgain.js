/**
 * 净收益门槛：一刀切掉的 token 必须明显大于这一刀产生的卡片 token。
 *
 * 上游只检查 `gain >= chunkMin`（毛收益，默认 1000），但卡片本身常有 1000-8000 token，
 * 于是出现「同一轮连切 4 刀、每刀 2.5K、净赚 1K」的碎切。本机 46 会话模拟：
 * 门槛 1000 时 1,847 刀，加净收益门槛后 388 刀。
 *
 * Net gain gate: a cut must remove clearly more tokens than its card costs.
 */

const CHARS_PER_TOKEN = 3.5;

/** 卡片正文估算成 token；只用于决策，不参与记账。 */
export function estimateCardTokens(cardText, charsPerToken = CHARS_PER_TOKEN) {
  const chars = typeof cardText === "string" ? cardText.length : 0;
  return Math.ceil(chars / charsPerToken);
}

/** 切掉 spanTokens、付出 cardText 的成本后，净收益是否低于门槛。 */
export function netGainTooSmall(spanTokens, cardText, minNetGain) {
  const threshold = Number.isFinite(minNetGain) ? minNetGain : 0;
  if (threshold <= 0) return false;
  const net = (spanTokens || 0) - estimateCardTokens(cardText);
  return net < threshold;
}