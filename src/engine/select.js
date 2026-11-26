/**
 * 卡片选行：把「留哪几行」当成带预算的选优问题，而不是按原文顺序先到先得。
 *
 * 为什么要有这个：脚本卡（大刀本地归纳）一次要吃掉几十 k 到几 M 字符的整段，
 * Kept 预算只有 8k–40k。旧做法是 hard 行在前、covered 行在后，预算一满就丢后面的，
 * 于是「越靠后越重要」的规律被默认成「越靠后越不重要」——后段的失败原因、用户
 * 最后一条约束经常正好被裁掉。
 *
 * 数学上这是带预算的最大覆盖（budgeted maximum coverage）：每条候选行有一个价值
 * v_i 与成本 w_i（字符数），预算 B。目标是 max Σ v_i x_i s.t. Σ w_i x_i ≤ B。
 * 这是 NP-hard 的，但价值函数满足「边际收益递减」（submodular），所以按
 * 价值密度 v_i / w_i^α 贪心就有 1-1/e 量级的近似保证 [1]；再叠一层 MMR 惩罚
 * [2] 避免选进来一堆近乎重复的行（同一个报错抄了五遍）。
 *
 *   score_i = v_i / w_i^α · (1 - λ · max_{j∈S} sim(i, j))
 *
 * 其中 sim 用词的 Jaccard（英文词 + 中文二元组），λ 控制去重强度。
 * 硬事实（用户约束、失败诊断）先按 required 无条件占预算，剩下的按上式贪心。
 *
 * [1] Nemhauser, Wolsey, Fisher (1978) 贪心对单调次模函数给出 (1-1/e) 近似：
 *     https://www.formalrag.com/topics/context-selection-submodular-dpp/
 * [2] Carbonell & Goldstein (1998) MMR：
 *     λ·Rel(d,q) − (1−λ)·max_{d'∈S} Sim(d,d')
 */

/** 硬事实的价值加权：报错、路径、约束、命令比普通叙述值钱。 */
const BONUS = [
  { re: /失败|错误|报错|异常|超时|中止|traceback|exception|failed|error|abort/i, w: 3 },
  { re: /必须|不要|不能|只能|永远|一律|记得|要求|约束|must|never|always|should not/i, w: 4 },
  { re: /[A-Za-z]:\\|\/(?:usr|home|tmp|etc)\/|\.(?:js|mjs|ts|tsx|json|yml|yaml|md|ps1|py)\b/i, w: 2.5 },
  { re: /\b(?:npm|npx|pnpm|git|node|curl|pwsh|powershell|dsh|python|pytest)\b/i, w: 2 },
  { re: /\b\d+(?:\.\d+)?\s*(?:k|m|ms|s|%|token|tokens|字符|字节|次|刀|行|个)\b/i, w: 1.5 },
  { re: /待办|未完成|下一步|TODO|FIXME|next step|remaining/i, w: 1.5 },
  { re: /exit code|退出码|status\s*[:=]\s*\d{3}|\b40[0-9]\b|\b50[0-9]\b/i, w: 2 },
];

const NUMBER_FACT = /\b\d{3,}\b/;
const CJK = /[\u4e00-\u9fff]/g;

/** 一条候选行的价值：结构先验 + 长度惩罚（超长行占预算但信息密度低）。 */
export function lineValue(text) {
  const line = String(text || "");
  if (!line.trim()) return 0;
  let value = 1;
  for (const rule of BONUS) if (rule.re.test(line)) value += rule.w;
  if (NUMBER_FACT.test(line)) value += 0.5;
  // 太长的一行往往是把整段 JSON / 日志糊进来：给一点惩罚，别让它一口吃掉预算。
  const lengthPenalty = line.length > 240 ? 1 + (line.length - 240) / 600 : 1;
  return value / lengthPenalty;
}

/** 词袋：英文按词，中文按二元组——够算 Jaccard，不需要分词器。 */
export function tokensOf(text) {
  const line = String(text || "").toLowerCase();
  const out = new Set();
  for (const word of line.match(/[a-z0-9_\-]{3,}/g) || []) out.add(word);
  const cjk = line.match(CJK) || [];
  if (cjk.length >= 2) for (let i = 0; i + 1 < cjk.length; i++) out.add(cjk[i] + cjk[i + 1]);
  return out;
}

function jaccard(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  const [small, big] = a.size <= b.size ? [a, b] : [b, a];
  for (const token of small) if (big.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * 预算内的选行。
 *
 * @param {Array<{text:string, required?:boolean, id?:number}>} items 候选行（按原文顺序）
 * @param {object} options
 * @param {number} options.budget 字符预算
 * @param {number} [options.alpha] 长度指数：越大越偏向短行（默认 0.6）
 * @param {number} [options.lambda] 去重强度：0 关，1 完全按相似度压（默认 0.5）
 * @returns {{kept: number[], used: number, dropped: number, requiredDropped: number}}
 */
export function selectLines(items, options = {}) {
  const budget = Math.max(0, Number(options.budget) || 0);
  const alpha = Number.isFinite(options.alpha) ? options.alpha : 0.6;
  const lambda = Number.isFinite(options.lambda) ? options.lambda : 0.5;
  const list = (items || []).filter((item) => item && String(item.text || "").trim());
  const picked = new Set();
  const tokens = new Map();
  const tokenOf = (index) => {
    if (!tokens.has(index)) tokens.set(index, tokensOf(list[index].text));
    return tokens.get(index);
  };
  let used = 0;

  // 1) required 先来：硬事实不能因为「分数低」被挤掉，只能因为真的装不下。
  //    真装不下时也按价值密度排序——丢的是最不值钱的那几条，不是恰好排在后头的。
  let requiredDropped = 0;
  const requiredOrder = list
    .map((item, index) => ({ index, cost: item.text.length, density: lineValue(item.text) / Math.pow(Math.max(1, item.text.length), alpha) }))
    .filter((item) => list[item.index].required)
    .sort((a, b) => b.density - a.density);
  for (const item of requiredOrder) {
    if (used + item.cost > budget) { requiredDropped += 1; continue; }
    picked.add(item.index); used += item.cost;
  }

  // 2) 其余按 价值密度 × 去重惩罚 贪心：每次取当前边际收益最高的一行。
  const candid = [];
  for (let i = 0; i < list.length; i++) {
    if (picked.has(i)) continue;
    const cost = list[i].text.length;
    if (cost === 0) continue;
    candid.push({ index: i, cost, density: lineValue(list[i].text) / Math.pow(cost, alpha) });
  }
  candid.sort((a, b) => b.density - a.density);

  for (const item of candid) {
    if (used + item.cost > budget) continue;
    let similarity = 0;
    const mine = tokenOf(item.index);
    for (const chosen of picked) {
      const sim = jaccard(mine, tokenOf(chosen));
      if (sim > similarity) similarity = sim;
    }
    // 近重复（相似度 ≥ 0.6）直接不要：同一段报错抄三遍只是白吃预算。
    // 中等相似（< 0.6）照收，但 λ 越大越容易挡掉——λ 是「容忍多少重复」的旋钮。
    if (similarity >= 0.6) continue;
    if (similarity > 0 && 1 - lambda * similarity < 0.35) continue;
    picked.add(item.index);
    used += item.cost;
  }

  return {
    kept: [...picked].sort((a, b) => a - b),
    used,
    dropped: list.length - picked.size,
    requiredDropped,
  };
}
