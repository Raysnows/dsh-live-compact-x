import { mergeSpanCandidates } from "../policy.js";

let pass = 0, fail = 0;
const ok = (c, n, extra = "") => {
  if (c) { pass++; console.log("  ok  " + n); } else { fail++; console.log("  FAIL " + n + " " + extra); }
};
// 每条 1000 token 的会话，便于心算。
const itemsOf = (count, each = 1000) => Array.from({ length: count }, () => ({ tokens: each }));
const ALL = () => true;

console.log("1. 旧规则卡死的场景：卡片离切点 8 万 token，现在能截出子段");
{
  const items = itemsOf(200);
  const cards = [40, 60, 80, 100, 120];        // 最新卡在第 120 条
  const got = mergeSpanCandidates({ items, cards, end: 199, spanCap: 15000, chunkMin: 1000, totalTokens: 200000, breakEven: 2 });
  ok(got.length === 5, "每张卡各给一个候选，不再用 break 把老卡全砍掉（" + got.length + "）");
  ok(got.every((c) => c.spanTokens <= 15000), "候选都不超过刀长上限");
  ok(got.some((c) => c.startIndex === 120 && c.stop === 134), "最新卡截到第 134 条为止（15k）");
  ok(got.some((c) => c.startIndex === 40 && c.stop === 54), "最老卡也能截出自己的 15k 子段");
  ok(got[0].startIndex !== undefined && got[0].startIndex === 120, "按划算程度排序时近卡优先");
}

console.log("2. 整段装得下时，行为与旧版一致（切到 end）");
{
  const items = itemsOf(200);
  const got = mergeSpanCandidates({ items, cards: [190], end: 199, spanCap: 32000, chunkMin: 1000, totalTokens: 200000 });
  ok(got.length === 1 && got[0].stop === 199 && got[0].spanTokens === 10000, "stop=end，span=10k");
}

console.log("3. 排序：近距离的卡片排前面（重算更少）");
{
  const items = itemsOf(200);
  const got = mergeSpanCandidates({
    items, cards: [40, 160], end: 199, spanCap: 15000, chunkMin: 1000, totalTokens: 200000, breakEven: 2,
  });
  ok(got[0].startIndex === 160, "卡在 160（重算 40k）排在卡在 40（重算 160k）之前");
  ok(got[0].rewriteTokens === 25000 && got[1].rewriteTokens === 145000, "重算量 = 总量 - 前缀 - 被切掉的段（" + got[0].rewriteTokens + " / " + got[1].rewriteTokens + "）");
  const cheap = mergeSpanCandidates({
    items, cards: [40, 160], end: 199, spanCap: 15000, chunkMin: 1000, totalTokens: 200000, breakEven: 0,
  });
  ok(cheap[0].startIndex === 160, "breakEven=0 时按 1 倍算，仍然偏向近距离卡片");
}

console.log("4. 段太短的卡片被跳过，不会退回到更差的选择");
{
  const items = itemsOf(200);
  const only = mergeSpanCandidates({ items, cards: [198], end: 199, spanCap: 32000, chunkMin: 5000, totalTokens: 200000 });
  ok(only.length === 0, "只有 2k 的段、下限 5k -> 没有候选");
  const both = mergeSpanCandidates({ items, cards: [150, 198], end: 199, spanCap: 32000, chunkMin: 5000, totalTokens: 200000 });
  ok(both.length === 1 && both[0].startIndex === 150, "近卡不合格时用远卡，段长 50k 截到上限");
}

console.log("5. 起点/切点合法性由调用方决定");
{
  const items = itemsOf(200);
  const blockedStart = mergeSpanCandidates({
    items, cards: [100, 120], end: 199, spanCap: 15000, chunkMin: 1000, totalTokens: 200000,
    startOk: (i) => i !== 120,
  });
  ok(blockedStart.length === 1 && blockedStart[0].startIndex === 100, "工具对没配对的那张卡不参与");

  // 135..140 不允许在这里切（例如工具对边界），切点要退到最后一个合法位置。
  const blockedStop = mergeSpanCandidates({
    items, cards: [120], end: 199, spanCap: 15000, chunkMin: 1000, totalTokens: 200000,
    stopOk: (i) => !(i >= 135 && i <= 140),
  });
  ok(blockedStop.length === 1 && blockedStop[0].stop === 134, "切点退回到 134（" + blockedStop[0]?.stop + "）");

  const allBlocked = mergeSpanCandidates({
    items, cards: [120], end: 199, spanCap: 15000, chunkMin: 1000, totalTokens: 200000, stopOk: () => false,
  });
  ok(allBlocked.length === 0, "没有合法切点 -> 没有候选");
}

console.log("6. 边界：恰好等于上限、重复卡、越界卡、缺 token");
{
  const items = itemsOf(200);
  const exact = mergeSpanCandidates({ items, cards: [120], end: 134, spanCap: 15000, chunkMin: 1000, totalTokens: 200000 });
  ok(exact.length === 1 && exact[0].stop === 134 && exact[0].spanTokens === 15000, "累加正好等于上限时允许");
  const over = mergeSpanCandidates({ items, cards: [120], end: 199, spanCap: 14500, chunkMin: 1000, totalTokens: 200000 });
  ok(over.length === 1 && over[0].stop === 133 && over[0].spanTokens === 14000, "14.5k 上限只能装 14 条");

  const dup = mergeSpanCandidates({ items, cards: [120, 120, 140, 140], end: 199, spanCap: 5000, chunkMin: 1000, totalTokens: 200000 });
  ok(dup.length === 2, "同一张卡重复出现只算一次");
  ok(dup.length === 2 && dup.every((c) => c.stop - c.startIndex === 4), "重复卡各自给出 5k 子段");

  const oob = mergeSpanCandidates({ items, cards: [-1, 0, 200, 250], end: 199, spanCap: 5000, chunkMin: 1000, totalTokens: 200000 });
  ok(oob.length === 1 && oob[0].startIndex === 0, "越界卡被忽略，第 0 条仍可用");

  const gaps = [{ tokens: 1000 }, {}, { tokens: undefined }, { tokens: 1000 }];
  const sparse = mergeSpanCandidates({ items: gaps, cards: [0], end: 3, spanCap: 32000, chunkMin: 1000, totalTokens: 2000 });
  ok(sparse.length === 1 && sparse[0].spanTokens === 2000, "缺失 token 按 0 计（" + sparse[0]?.spanTokens + "）");
}

console.log("7. 空输入不抛错");
{
  ok(mergeSpanCandidates().length === 0, "无参调用返回空数组");
  ok(mergeSpanCandidates({ items: itemsOf(10), cards: [], end: 9 }).length === 0, "没有卡片 -> 空");
  ok(mergeSpanCandidates({ items: itemsOf(10), cards: [5], end: -1 }).length === 0, "end=-1 -> 空");
  const one = mergeSpanCandidates({ items: itemsOf(10), cards: [0], end: 9, spanCap: 32000, chunkMin: 1000 });
  ok(one.length === 1 && one[0].prefixTokens === 0 && one[0].rewriteTokens === 0, "totalTokens 缺省时重算量为 0");
}

console.log("8. 整窗优先：中刀必须一刀切到尾巴（重算面最小）");
{
  const items = itemsOf(200);
  // 最新卡在第 120 条，到 end 有 8 万 token；旧规则这段 > chunkMax 直接 break，
  // 现在给一个整窗上限，只要不超过它就能整段压成一张卡。
  const wide = mergeSpanCandidates({
    items, cards: [120], end: 199, spanCap: 15000, hardCap: 96000, chunkMin: 1000, totalTokens: 200000, breakEven: 2,
  });
  ok(wide.length === 1 && wide[0].window === "full", "整窗候选（" + wide[0]?.window + "）");
  ok(wide[0].stop === 199 && wide[0].spanTokens === 80000, "切点落在 end，段长 80k（" + wide[0]?.spanTokens + "）");
  ok(wide[0].rewriteTokens === 0, "整窗切到尾巴 -> 尾巴不用重算（" + wide[0]?.rewriteTokens + "）");

  const tooLong = mergeSpanCandidates({
    items, cards: [120], end: 199, spanCap: 15000, hardCap: 40000, chunkMin: 1000, totalTokens: 200000, breakEven: 2,
  });
  ok(tooLong.length === 1 && tooLong[0].window === "truncated", "超上限退化成截断子段（" + tooLong[0]?.window + "）");
  ok(tooLong[0].stop === 134 && tooLong[0].spanTokens === 15000, "截断仍按 spanCap 收口");

  const perCard = mergeSpanCandidates({
    items, cards: [100, 120, 180], end: 199, spanCap: 15000, hardCap: 96000, chunkMin: 1000, totalTokens: 200000,
  });
  ok(perCard.length === 3, "每张卡只给一个候选（整窗或截断，不重复）");
  ok(perCard.filter((c) => c.window === "full").length === 2, "能整窗切完的两张走整窗");
  ok(perCard.some((c) => c.window === "truncated" && c.startIndex === 100), "离 end 16 万的那张只能截断");
  ok(perCard[0].window === "full" && perCard[0].startIndex === 120, "排序：整窗的近卡最划算（" + perCard[0]?.startIndex + "/" + perCard[0]?.window + "）");
}

console.log("9. 整窗也不够 chunkMin 时不出手");
{
  const items = itemsOf(200);
  const short = mergeSpanCandidates({
    items, cards: [198], end: 199, spanCap: 32000, hardCap: 96000, chunkMin: 5000, totalTokens: 200000,
  });
  ok(short.length === 0, "卡片离切点只剩 2k，整窗也不够下限 -> 没有候选");
}

console.log("\n通过 " + pass + " / 失败 " + fail);
process.exit(fail ? 1 : 0);