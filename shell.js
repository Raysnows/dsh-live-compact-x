/**
 * 薄入口。这个文件必须能求值，引擎加载失败也不能把这里抛掉。
 * Thin entry. This file must evaluate even when the engine cannot load.
 * A throw here leaves stock disabled and /compact waiting.
 *
 * 预检查只解析配置，校验交给实际引擎；构造失败时释放本次注册，不重试原版盖掉报错。
 * Resolve config before construction; let the engine validate it and preserve its actual error.
 */
import { loadBase, loadCompaction, loadSchema, STOCK_ENGINE } from "./adapter.js";
import { configSchema, engineConfig } from "./settings.js";
import { installPresetGate } from "./gate.js";
import { installSettingsBridge } from "./bridge.js";
import { installPruneHook } from "./v2/prune-hook.js";
import { spineProjectionDefinition } from "./projection.js";
import { readGlobalStats } from "./stats.js";
import { DEFAULTS, readSettings } from "./settings.js";
import { presetLayerFor } from "./presets.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";
import { docsFor } from "./docs.js";
import { shadowDirectory } from "./shadow.js";
import { sessionDir } from "./shadow.js";
import { defaultV2, v2Enabled } from "./v2/store-switch.js";

let Engine = null;
let Stock = null;
let CompactionEngine = null;
let ManualCompactionError = null;
let loadError = null;
let Schema = null;

if (process.env.SPINE_ENGINE_FAIL === "import") {
  loadError = new Error("spine: engine import refused");
} else {
  try {
    const engine = await import("./index.js");
    Engine = engine.default;
  } catch (error) {
    loadError = error instanceof Error ? error : new Error(String(error));
  }
}

try {
  const compaction = await loadCompaction();
  CompactionEngine = compaction.CompactionEngine;
  ManualCompactionError = compaction.ManualCompactionError;
} catch (error) {
  loadError ??= error instanceof Error ? error : new Error(String(error));
}

try {
  const stock = await loadBase();
  Stock = stock.BasicCompactionEngine;
} catch (error) {
  if (!loadError) loadError = error instanceof Error ? error : new Error(String(error));
}

// 官方设置界面按这份 schema 自动生成表单。拿不到 schemastery 就退回 stock 的 schema。
try {
  const schema = await loadSchema();
  Schema = configSchema(schema.default, Stock?.Config);
} catch {
  Schema = null;
}

function reasonText(error) {
  return error instanceof Error ? error.message : String(error);
}

export function preflightConfig(config = {}) {
  return engineConfig(config);
}

function compactionRecord(ctx) {
  const key = ctx?.[Symbol.for("cordis.isolate")]?.compaction;
  return key === undefined ? undefined : ctx?.reflect?.store?.[key];
}

function releaseCompaction(ctx, previous) {
  const store = ctx?.reflect?.store;
  const key = ctx?.[Symbol.for("cordis.isolate")]?.compaction;
  const current = compactionRecord(ctx);
  const currentFiber = current?.fiber ?? current?.ctx?.fiber;
  const contextFiber = ctx?.fiber;
  if (!current || current === previous || currentFiber !== contextFiber) return false;
  delete store[key];
  if (contextFiber?.store?.compaction === current) delete contextFiber.store.compaction;
  return true;
}

function detachRootStockCompaction(ctx) {
  const store = ctx?.reflect?.store;
  const current = compactionRecord(ctx);
  const key = ctx?.[Symbol.for("cordis.isolate")]?.compaction;
  const fiber = current?.fiber ?? current?.ctx?.fiber;
  const moduleName = fiber?.entry?.options?.name;
  if (!current || moduleName !== STOCK_ENGINE || fiber === ctx?.fiber) return false;
  if (compactionRecord(ctx) !== current) return false;
  const fiberStore = fiber?.store;
  if (fiberStore?.compaction === current) delete fiberStore.compaction;
  delete store[key];
  return { store, key, current, fiber, fiberStore };
}

function commitRootStockCompaction(replacement) {
  if (!replacement || replacement.committed) return false;
  replacement.committed = true;
  try {
    // Cordis disposal is async. The replacement has already registered, so
    // the old root fiber can now drain its effects without blocking startup.
    const pending = replacement.fiber?.dispose?.();
    pending?.catch?.(() => {});
  } catch {}
  return true;
}

function rollbackRootStockCompaction(replacement) {
  if (!replacement || replacement.committed) return false;
  const current = replacement.store?.[replacement.key];
  if (current !== undefined && current !== replacement.current) return false;
  replacement.store[replacement.key] = replacement.current;
  if (replacement.fiberStore && replacement.fiberStore.compaction === undefined) {
    replacement.fiberStore.compaction = replacement.current;
  }
  return true;
}

export function releaseRootStockCompaction(ctx, { deferDispose = false } = {}) {
  const replacement = detachRootStockCompaction(ctx);
  if (!replacement) return false;
  if (deferDispose) {
    replacement.committed = false;
    replacement.commit = () => commitRootStockCompaction(replacement);
    replacement.rollback = () => rollbackRootStockCompaction(replacement);
    return replacement;
  }
  commitRootStockCompaction(replacement);
  return true;
}

// 面板数据：把「切过多少/切在哪/卡片文件在哪」做成会话投影，客户端直接读。
const REPO_URL = "https://github.com/Raysnows/dsh-live-compact-x";
const ISSUES_URL = REPO_URL + "/issues";

// 面板要显示的是生效值：构造时把本次加载的配置记下来，投影那边按需解析。
let latestConfig = null;

function pluginDir() {
  try { return dirname(fileURLToPath(import.meta.url)); } catch { return ""; }
}

function ownVersion(dir) {
  if (!dir) return "";
  try { return String(JSON.parse(readFileSync(join(dir, "package.json"), "utf8")).version || ""); } catch { return ""; }
}


// 服务可选（老宿主没有 sessionProjections），注册失败只影响面板，绝不影响压缩。
let zod = null;
try { zod = (await import("zod")).z; } catch {}

function installCutsProjection(ctx) {
  try {
    const projections = ctx?.get?.("sessionProjections");
    if (!projections?.register) return;
    const here = pluginDir();
    const definition = spineProjectionDefinition({
      zod,
      shadowDir: (sid) => {
        try { return sessionDir(shadowDirectory(), sid || "__default__"); } catch { return ""; }
      },
      // 面板上的旋钮值：配置 > 自定义档（会话/工作区/全部）> 文件 > 环境 > 默认，和引擎同一套解析。
      settingsReader: (sid) => readSettings(latestConfig || {}, process.env, presetLayerFor(sid || "")),
      // 「全部会话」：直接汇总 shadow 根目录的决策日志，按 mtime 判重，1.5 秒缓存。
      globalStatsReader: () => readGlobalStats({ dir: shadowDirectory() }),
      // 「默认档」按钮填的就是这份引擎默认值。
      defaults: DEFAULTS,
      docs: docsFor(here, { repo: REPO_URL, issues: ISSUES_URL, version: ownVersion(here) }),
    });
    let handle = null;
    let disposed = false;
    Promise.resolve(projections.register(definition))
      .then((registered) => {
        handle = registered;
        if (disposed) { try { registered?.dispose?.(); } catch {} }
      })
      .catch((error) => ctx?.logger?.debug?.(`spine: cuts projection skipped: ${reasonText(error)}`));
    ctx?.effect?.(() => () => {
      disposed = true;
      try { handle?.dispose?.(); } catch {}
    }, "spine: cuts projection");
  } catch (error) {
    ctx?.logger?.debug?.(`spine: cuts projection unavailable: ${reasonText(error)}`);
  }
}

/** 面板设置桥：可选服务（纯 CLI 宿主没有 webServer），挂了也只影响面板，不影响压缩。 */
function installPanelBridge(ctx) {
  try {
    const here = pluginDir();
    installSettingsBridge(ctx, {
      getConfig: () => latestConfig || {},
      docs: docsFor(here, { repo: REPO_URL, issues: ISSUES_URL, version: ownVersion(here) }),
    });
  } catch (error) {
    ctx?.logger?.debug?.("spine: settings bridge skipped: " + String(error?.message ?? error));
  }
}

function visibleTakeover(ctx, reason) {
  const line = `spine: ${MARK}。${reason}`;
  console.error(line);
  ctx?.logger?.warn?.(line);
}

const MARK = "本会话未接管";

const UnavailableCompaction = CompactionEngine
  ? class extends CompactionEngine {
    constructor(ctx, reason) {
      super(ctx);
      this.reason = reason;
      ctx.logger?.warn?.(`spine: ${MARK}。压缩没有装上，这一刀没有执行。${reason}`);
    }

    compactIfNeeded() {
      return Promise.reject(new Error(`spine: ${MARK}。压缩没有装上，这一刀没有执行。${this.reason}`));
    }

    compactNow() {
      const message = `spine: ${MARK}。压缩没有装上，这一刀没有执行。${this.reason}`;
      if (ManualCompactionError) return Promise.reject(new ManualCompactionError("summary", message));
      return Promise.reject(new Error(message));
    }
  }
  : null;

export default class LiveCompactEntry {
  static inject = ["llm", "tokenMeter", "sessions"];
  static Config = Schema || Stock?.Config || Engine?.Config;

  constructor(ctx, config) {
    try { latestConfig = config || {}; } catch {}
    installCutsProjection(ctx);
    installPanelBridge(ctx);
    installPresetGate(ctx, config);
    // V2：在被官方修剪器改写之前，把那一小撮原文压一份兜底副本。
    if (v2Enabled()) {
      try {
        const backend = defaultV2();
        const pruner = ctx.get?.("toolResultPruner");
        if (pruner) ctx.effect?.(() => installPruneHook(pruner, backend.fallback), "spine v2: prune hook");
      } catch {}
    }
    const previousCompaction = compactionRecord(ctx);
    let cause = loadError;
    let resolvedConfig;
    let skipStock = process.env.SPINE_ENGINE_FAIL === "construct";
    if (skipStock) cause = new Error("spine: constructor refused");
    if (!loadError && !skipStock) {
      try {
        resolvedConfig = preflightConfig(config);
      } catch (error) {
        cause = error instanceof Error ? error : new Error(String(error));
        skipStock = true;
      }
    }
    if (!loadError && !skipStock && Engine) {
      let rootStockReplacement = false;
      try {
        rootStockReplacement = releaseRootStockCompaction(ctx, { deferDispose: true });
        const engine = new Engine(ctx, config, resolvedConfig);
        rootStockReplacement?.commit?.();
        return engine;
      } catch (error) {
        cause = error instanceof Error ? error : new Error(String(error));
        releaseCompaction(ctx, previousCompaction);
        rootStockReplacement?.rollback?.();
        skipStock = true;
      }
    }
    cause ??= new Error("spine: engine missing");
    if (!skipStock && process.env.SPINE_STOCK_FAIL !== "1" && Stock) {
      try {
        visibleTakeover(ctx, `这一轮用原版压缩。${reasonText(cause)}`);
        return new Stock(ctx, engineConfig(config));
      } catch (error) {
        cause = error instanceof Error ? error : new Error(String(error));
        releaseCompaction(ctx, previousCompaction);
      }
    }
    visibleTakeover(ctx, reasonText(cause));
    if (!UnavailableCompaction) throw new Error(`spine: ${MARK}。压缩接口没有装上。${reasonText(cause)}`);
    return new UnavailableCompaction(ctx, reasonText(cause));
  }
}
