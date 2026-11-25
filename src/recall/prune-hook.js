/**
 * 在修剪器动手之前抓原文。
 *
 * 宿主把 toolResultPruner.pruneContent(blocks) 的结果写回事件，原文随即消失。
 * 这里把它的方法换成「先存一份、再交给原方法」，只在真的会被修剪时才写盘。
 */
import { FallbackStore, PRUNE_MARKER } from "./fallback-store.js";

function textOfBlocks(blocks) {
  if (!Array.isArray(blocks)) return "";
  return blocks.filter((b) => b && b.type === "text").map((b) => b.text || "").join("\n");
}

export function installPruneHook(pruner, fallback, { onCapture } = {}) {
  if (!pruner || typeof pruner.pruneContent !== "function") return () => {};
  if (pruner.__fallbackHooked) return () => {};
  pruner.__fallbackHooked = true;
  const original = pruner.pruneContent.bind(pruner);

  pruner.pruneContent = function hookedPrune(blocks) {
    const pruned = original(blocks);
    if (pruned == null) return pruned;           // 没超预算，不会改写
    const text = textOfBlocks(blocks);
    if (text && !text.includes(PRUNE_MARKER)) {
      const rec = fallback.put(text);
      onCapture?.({ ...rec, text });
    }
    return pruned;
  };

  return () => {
    pruner.pruneContent = original;
    delete pruner.__fallbackHooked;
  };
}
