/**
 * 面板设置桥：/api/dsh-live-compact-x-settings/{describe,save,doc}
 *
 * 为什么不用宿主的 configForms：官方表单只在「这个 entry 被登记成可编辑的
 * volatile 命名空间」时才存在；一旦没登记，面板上的勾选框与保存按钮点下去
 * 只会安静地失败。这个桥写的是引擎每一回合真正读的那份文件
 * （~/.dsh/spine-settings.json），通道断了会明说，不会装死。
 *
 * 安全：同源 + 回环地址 + 宿主自己的 requestRejection（有就先用它）。
 * 拒绝跨站请求，避免被网页当 confused deputy 使。
 */
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { describeSettings, settingsFilePath, writeOverrides } from "./settings.js";
import { DECISIONS_NAME, shadowDirectory } from "../engine/shadow.js";
import { setSwitchState, switchSnapshot } from "./switch.js";
import { activePresetFor, applyPreset, deletePreset, presetLayerFor, presetsSnapshot, savePreset } from "./presets.js";
import { parseChangelog } from "./docs.js";

export const BRIDGE_PREFIX = "/api/dsh-live-compact-x-settings";

const ISSUE_URL = "https://github.com/Raysnows/dsh-live-compact-x/issues/new";

/** 诊断报告要能被贴到公开 issue：先把本机标识抹掉，再截断。 */
function sanitizeReport(text, home = homedir()) {
  let out = String(text || "");
  if (home) out = out.split(home).join("~");
  out = out.replace(/[A-Za-z]:\\+Users\\+[^\\\s"']+/gi, "~");
  out = out.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<id>");
  out = out.replace(/\b(?:sk-[A-Za-z0-9_-]{8,}|Bearer\s+[A-Za-z0-9._-]{8,}|[A-Za-z0-9_-]{32,})\b/g, "<secret>");
  out = out.replace(/[A-Za-z]:\\[^\s"']+/g, (path) => "<path>/" + String(path).split(/[\\/]/).pop());
  return out;
}

function readTailLines(file, limit = 30, maxBytes = 96 * 1024) {
  try {
    const stat = statSync(file);
    const start = Math.max(0, stat.size - maxBytes);
    const text = readFileSync(file, "utf8").slice(start);
    const lines = text.split("\n").filter(Boolean);
    if (start > 0 && lines.length) lines.shift();
    return lines.slice(-limit);
  } catch {
    return [];
  }
}

function directoryFootprint(dir) {
  const out = { files: 0, bytes: 0 };
  let entries = [];
  try { entries = readdirSync(dir, { recursive: true, withFileTypes: true }); } catch { return out; }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    try {
      out.files += 1;
      out.bytes += statSync(join(entry.parentPath || entry.path || dir, entry.name)).size;
    } catch {}
  }
  return out;
}

/** 百分位：样本少也给个可信的 p50 / p90，别用平均值糊过去。 */
function percentile(values, ratio) {
  const list = values.filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  if (!list.length) return null;
  const idx = Math.min(list.length - 1, Math.max(0, Math.round((list.length - 1) * ratio)));
  return list[idx];
}

function readDecisionRecords(dir, limit = 400) {
  const out = [];
  for (const line of readTailLines(join(dir, DECISIONS_NAME), limit, 512 * 1024)) {
    try { out.push(JSON.parse(line)); } catch { /* 坏行跳过，不能让诊断自己挂掉 */ }
  }
  return out;
}

/** 参数展开成 key=value 一行，只留数值与布尔——够复现，不带任何路径。 */
function flattenParams(source) {
  return Object.entries(source || {})
    .filter(([, value]) => typeof value === "number" || typeof value === "boolean")
    .map(([key, value]) => key + "=" + value);
}

const fmtK = (n) => (Number.isFinite(n) ? (n >= 1000 ? (n / 1000).toFixed(1) + "k" : String(n)) : "?");

/**
 * 面板「提交问题日志」用的脱敏诊断。
 *
 * 内容按「调参 / 复现需要什么」组织：全部切割参数（生效值 + 与默认的差异）、
 * 刀法统计、段与卡片的分布、被拒原因、本地脚本生成的卡片指标，最后才是最近的
 * 决策流水。旧版只给最近 30 条决策，段长 / 卡长 / 重算面这些调参最需要的数
 * 全丢了，收到日志也没法复现一刀为什么切不动。
 *
 * 全段仍走 sanitizeReport：家目录、用户名、会话 id、token、绝对路径都抹掉；
 * 只输出数字和枚举，不输出任何聊天正文。
 */
function buildDiagnostic(sid, getConfig) {
  const described = describeSettings(getConfig(), presetLayerFor(sid));
  const effective = described.effective || {};
  const defaults = described.defaults || {};
  const params = flattenParams(effective);
  const drift = Object.keys(defaults)
    .filter((key) => typeof defaults[key] === "number"
      && typeof effective[key] === "number"
      && effective[key] !== defaults[key])
    .map((key) => key + "=" + effective[key] + "（默认 " + defaults[key] + "）");
  const fixed = flattenParams(described.fixed);
  const dir = shadowDirectory();
  const shadow = directoryFootprint(dir);
  const records = readDecisionRecords(dir);

  const cuts = records.filter((record) => record.phase === "cut" && record.result === "committed");
  const mergeCuts = cuts.filter((record) => record.merge === true);
  const spanStats = cuts.map((record) => Number(record.tokens)).filter(Number.isFinite);
  const cardStats = cuts.map((record) => Number(record.tokens) - Number(record.saved)).filter(Number.isFinite);
  const missStats = records
    .filter((record) => record.phase === "cut-skip" || record.phase === "merge-skip")
    .map((record) => Number(record.missTokens))
    .filter(Number.isFinite);
  const ratios = cuts
    .map((record) => (Number(record.tokens) > 0 ? (Number(record.tokens) - Number(record.saved)) / Number(record.tokens) : NaN))
    .filter(Number.isFinite);
  const savedSum = cuts.reduce((total, record) => total + (Number(record.saved) || 0), 0);

  const handovers = records.filter((record) => record.phase === "official-handover" && record.result === "ran");
  const bigBefore = handovers.map((record) => Number(record.before)).filter(Number.isFinite);
  const bigSaved = handovers.reduce((total, record) => total + ((Number(record.before) || 0) - (Number(record.after) || 0)), 0);

  // 只统计「没切 / 没压成」的原因；started/usable 这种过程记录不算拒因。
  // 原因文本可能夹带上游报错原文，截断到 40 字符，别把诊断撑成一屏。
  const shortReason = (value) => String(value || "?").replace(/\s+/g, " ").slice(0, 40);
  const reasons = new Map();
  for (const record of records) {
    let key = "";
    if (record.phase === "cut-skip" || record.phase === "merge-skip") {
      key = record.phase + ":" + shortReason(record.reason);
    } else if (record.phase === "official-handover" && (record.result === "failed" || record.result === "deferred")) {
      key = "official-handover:" + record.result + ":" + shortReason(record.reason);
    } else if (record.phase === "official-summary" && ["failed", "empty", "not-smaller", "card-incomplete"].includes(record.result)) {
      key = "official-summary:" + shortReason(record.result);
    }
    if (key) reasons.set(key, (reasons.get(key) || 0) + 1);
  }

  const scriptSummaries = records.filter((record) => record.phase === "official-summary" && record.summarizer === "script");
  const scriptOk = scriptSummaries.filter((record) => record.result === "usable");
  const scriptMetrics = scriptOk.map((record) => [
    Number.isFinite(record.cardChars) ? "card=" + record.cardChars : "",
    Number.isFinite(record.hardCount) ? "hard=" + record.hardCount : "",
    Number.isFinite(record.missing) ? "missing=" + record.missing : "",
  ].filter(Boolean).join(" ")).filter(Boolean);

  const compact = (record) => [
    String(record.ts || "").replace("T", " ").slice(0, 19),
    record.sid ? "<id>" : "",
    record.phase || "",
    record.result || "",
    record.reason || "",
    Number.isFinite(record.totalTokens) ? "total=" + record.totalTokens : "",
    Number.isFinite(record.conversationTokens) ? "conv=" + record.conversationTokens : "",
    Number.isFinite(record.systemOverhead) ? "sys=" + record.systemOverhead : "",
    Number.isFinite(record.before) ? "before=" + record.before : "",
    Number.isFinite(record.after) ? "after=" + record.after : "",
    Number.isFinite(record.saved) ? "saved=" + record.saved : "",
    Number.isFinite(record.spanTokens) ? "span=" + record.spanTokens : "",
    Number.isFinite(record.cardTokens) ? "card=" + record.cardTokens : "",
    Number.isFinite(record.netGain) ? "net=" + record.netGain : "",
    Number.isFinite(record.payback) ? "payback=" + record.payback : "",
    Number.isFinite(record.rewriteTokens) ? "rewrite=" + record.rewriteTokens : "",
    Number.isFinite(record.missTokens) ? "miss=" + record.missTokens : "",
    record.policy ? "policy=" + record.policy : "",
    record.summarizer ? "summarizer=" + record.summarizer : "",
  ].filter(Boolean).join(" ");

  const lines = [
    "### 插件诊断（自动脱敏）",
    "- 插件版本：" + versionText(),
    "- 宿主平台：" + process.platform + " / node " + process.version,
    "- 设置文件：" + (described.file ? "~/" + String(described.file).split(/[\\/]/).slice(-2).join("/") : "(none)"),
    "- 生效档：" + JSON.stringify(presetsSnapshot(sid).layer || null),
    "- 总开关：" + JSON.stringify((() => {
      const snap = switchSnapshot(sid) || {};
      return { global: snap.global, session: snap.session, sessionDisabled: snap.sessionDisabled, disabledCount: snap.disabledCount };
    })()),
    "",
    "#### 切割参数（生效值，贴 issue 时这行就是复现配置）",
    "- 全部：" + params.join(", "),
    ...(drift.length ? ["- 与默认不同：" + drift.join(", ")] : []),
    ...(fixed.length ? ["- 宿主配置固定值：" + fixed.join(", ")] : []),
    "",
    "#### 刀法统计（来自决策日志 " + records.length + " 条）",
    "- 小切：" + cuts.length + " 刀（其中中刀 " + mergeCuts.length + "），共省 " + fmtK(savedSum) + " token，平均 " + fmtK(cuts.length ? Math.round(savedSum / cuts.length) : 0),
    "- 段/卡（小切样本 " + spanStats.length + "）：段 p50 " + fmtK(percentile(spanStats, 0.5)) + " / p90 " + fmtK(percentile(spanStats, 0.9))
      + "；卡 p50 " + fmtK(percentile(cardStats, 0.5)) + " / p90 " + fmtK(percentile(cardStats, 0.9))
      + "；卡占原文 p50 " + (ratios.length ? Math.round(percentile(ratios, 0.5) * 100) + "%" : "?"),
    "- 重算面 missTokens（被拒样本 " + missStats.length + "）：p50 " + fmtK(percentile(missStats, 0.5)) + " / p90 " + fmtK(percentile(missStats, 0.9)),
    "- 大刀：" + handovers.length + " 次，输入共 " + fmtK(bigBefore.reduce((a, b) => a + b, 0)) + " token（p50 " + fmtK(percentile(bigBefore, 0.5)) + "），共省 " + fmtK(bigSaved),
    "",
    "#### 被拒 / 空转原因（调门槛先看这里）",
    ...(reasons.size ? ["- " + [...reasons.entries()].map(([key, count]) => key + " × " + count).join("；")] : ["- (none)"]),
    "",
    "#### 本地脚本（officialScript=1 时的卡片）",
    "- 脚本摘要：" + scriptSummaries.length + " 次，成功 " + scriptOk.length,
    ...(scriptMetrics.length ? ["- 最近成功卡片：" + scriptMetrics.slice(-5).join(" | ")] : []),
    "",
    "#### 最近决策（最多 14 条）",
    ...records.slice(-14).map((record) => "  - " + compact(record)),
    "",
    "- shadow 目录：" + shadow.files + " 个文件 / " + (shadow.bytes / 1048576).toFixed(1) + "MB",
  ];
  const text = sanitizeReport(lines.join("\n")).slice(0, 12000);
  const body = sanitizeReport("请描述现象与复现步骤（已自动附上脱敏诊断，可直接编辑删改）：\n\n" + text).slice(0, 6000);
  const url = ISSUE_URL + "?title=" + encodeURIComponent("[bug] ") + "&body=" + encodeURIComponent(body);
  return { text, url };
}

function versionText() {
  try {
    return String(JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8")).version || "");
  } catch {
    return "";
  }
}

const MAX_BODY_BYTES = 64 * 1024;
const DOC_MAX_CHARS = 40000;
const LOOPBACK = /^(127\.|localhost$|::1$|\[::1\]$)/i;

function writeJson(res, status, body) {
  try {
    res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "referrer-policy": "no-referrer",
    });
    res.end(JSON.stringify(body));
  } catch {}
}

async function readJsonBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) return undefined;
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    return undefined;
  }
}

function isLoopback(address) {
  if (!address) return true;
  return /^(127\.|::1$|::ffff:127\.|localhost$)/i.test(String(address));
}

/** 同源 + 本地回环。不依赖宿主有没有 connection 服务，两种情况都关得住。 */
function requestAllowed(req) {
  if (req.headers["sec-fetch-site"] === "cross-site") return false;
  const host = req.headers.host;
  if (typeof host !== "string" || host.length === 0) return false;
  const origin = req.headers.origin;
  if (origin !== undefined) {
    try {
      if (new URL(origin).host !== host) return false;
    } catch {
      return false;
    }
  }
  if (!LOOPBACK.test(host.replace(/:\d+$/, ""))) return false;
  return isLoopback(req.socket && req.socket.remoteAddress);
}

/** 宿主有 connection.requestRejection 就让它判：那是它自己的鉴权入口。 */
function authRejection(sctx, req) {
  let connection;
  try { connection = sctx.get("connection"); } catch { connection = undefined; }
  if (!connection || typeof connection.requestRejection !== "function") return 0;
  try {
    return connection.requestRejection(req) ?? 0;
  } catch {
    return 503;
  }
}

function docPayload(lines) {
  if (!lines || !lines.text) return { ok: true, value: { available: false, text: "", path: lines?.path || "" } };
  const trimmed = String(lines.text).slice(0, DOC_MAX_CHARS);
  return { ok: true, value: { available: true, path: lines.path, text: trimmed, truncated: String(lines.text).length > DOC_MAX_CHARS } };
}

/**
 * @param ctx Cordis 插件上下文（可选注入 webServer，纯 CLI 宿主没有就不装）
 * @param options getConfig 取本次加载的 config（生效值要用它算优先级）；docs 交回文档路径
 */
export function installSettingsBridge(ctx, options = {}) {
  const getConfig = typeof options.getConfig === "function" ? options.getConfig : () => ({});
  const docs = options.docs || {};
  if (!ctx || typeof ctx.inject !== "function") return;

  // 一份完整的「这条会话现在长什么样」：生效值（含自定义档）+ 总开关 + 档位列表。
  const describeAll = (sid) => ({
    ...describeSettings(getConfig(), presetLayerFor(sid)),
    switch: switchSnapshot(sid),
    presets: presetsSnapshot(sid),
  });

  // 鉴权用子上下文：connection 在注入作用域里，取外面那层可能拿不到。
  let authContext = ctx;
  const handler = async (req, res) => {
    const rejection = authRejection(authContext, req);
    if (rejection) {
      writeJson(res, rejection, { ok: false, code: "unauthenticated", message: "host authentication required" });
      return;
    }
    if (!requestAllowed(req)) {
      writeJson(res, 403, { ok: false, code: "forbidden", message: "requests must come from the local GUI" });
      return;
    }
    if (req.method !== "POST") {
      writeJson(res, 405, { ok: false, code: "method", message: "POST only" });
      return;
    }
    const body = await readJsonBody(req);
    if (body === undefined || body === null || typeof body !== "object") {
      writeJson(res, 400, { ok: false, code: "bad-request", message: "malformed JSON body" });
      return;
    }
    try {
      if (body.op === "describe") {
        writeJson(res, 200, { ok: true, value: describeAll(body.sid) });
        return;
      }
      if (body.op === "switch") {
        const scope = body.scope === "all" ? "all" : body.scope === "session" ? "session" : "";
        if (!scope) {
          writeJson(res, 400, { ok: false, code: "bad-request", message: "scope 只能是 session / all" });
          return;
        }
        if (typeof body.enabled !== "boolean") {
          writeJson(res, 400, { ok: false, code: "bad-request", message: "enabled 必须是 true / false" });
          return;
        }
        const next = await setSwitchState({ scope, enabled: body.enabled, sid: body.sid });
        writeJson(res, 200, { ok: true, value: { switch: switchSnapshot(body.sid), savedAt: Date.now(), state: next } });
        return;
      }
      if (body.op === "save") {
        if (body.patch === null || typeof body.patch !== "object" || Array.isArray(body.patch)) {
          writeJson(res, 400, { ok: false, code: "bad-request", message: "patch must be an object" });
          return;
        }
        // 有自定义档在生效时，改动写回那个档（只影响它的范围），不写全局文件。
        const active = activePresetFor(body.sid);
        if (active) {
          const values = { ...active.values };
          for (const [key, raw] of Object.entries(body.patch)) {
            if (raw === null || raw === undefined) delete values[key];
            else values[key] = raw;
          }
          const saved = await savePreset({ scope: active.scope, sid: body.sid, id: active.id, name: active.name, values });
          writeJson(res, 200, {
            ok: true,
            value: {
              ...describeAll(body.sid),
              file: saved.presets.file,
              savedAt: Date.now(),
              target: { scope: active.scope, id: active.id, name: active.name },
            },
          });
          return;
        }
        const written = await writeOverrides(body.patch);
        writeJson(res, 200, { ok: true, value: { ...describeAll(body.sid), file: written.file, savedAt: Date.now(), target: null } });
        return;
      }
      if (body.op === "preset-save" || body.op === "preset-apply" || body.op === "preset-delete") {
        try {
          if (body.op === "preset-save") {
            await savePreset({ scope: body.scope, sid: body.sid, id: body.id, name: body.name, values: body.values });
          } else if (body.op === "preset-apply") {
            await applyPreset({ scope: body.scope, sid: body.sid, id: body.id });
          } else {
            await deletePreset({ scope: body.scope, sid: body.sid, id: body.id });
          }
        } catch (error) {
          writeJson(res, 400, { ok: false, code: "bad-request", message: error instanceof Error ? error.message : String(error) });
          return;
        }
        writeJson(res, 200, { ok: true, value: { ...describeAll(body.sid), savedAt: Date.now() } });
        return;
      }
      if (body.op === "diag") {
        // 只读诊断：面板拿去复制，或直接拼成 GitHub issue 链接。
        writeJson(res, 200, { ok: true, value: buildDiagnostic(body.sid, getConfig) });
        return;
      }
      if (body.op === "whatsnew") {
        // 「本版更新」：只读 CHANGELOG.md 的头几段，面板升级后第一眼就能看到改了什么。
        const target = String(docs.changelog || "");
        let text = "";
        if (target) { try { text = readFileSync(target, "utf8"); } catch { text = ""; } }
        const parsed = parseChangelog(text, { limit: 3 });
        writeJson(res, 200, {
          ok: true,
          value: {
            available: parsed.entries.length > 0,
            path: target,
            entries: parsed.entries,
            truncated: parsed.truncated,
          },
        });
        return;
      }
      if (body.op === "doc") {
        const which = body.which === "changelog" ? "changelog" : "readme";
        const target = String(docs[which] || "");
        if (!target) {
          writeJson(res, 200, { ok: true, value: { available: false, text: "", path: "" } });
          return;
        }
        let text = "";
        try { text = readFileSync(target, "utf8"); } catch { text = ""; }
        writeJson(res, 200, docPayload({ path: target, text }));
        return;
      }
      writeJson(res, 400, { ok: false, code: "bad-request", message: `unknown op "${String(body.op)}"` });
    } catch (error) {
      writeJson(res, 200, { ok: false, code: "internal", message: error instanceof Error ? error.message : String(error) });
    }
  };

  const register = (sctx) => {
    const webServer = sctx.get("webServer");
    if (!webServer || typeof webServer.register !== "function") return undefined;
    return webServer.register({ kind: "exact", path: BRIDGE_PREFIX, handler });
  };
  try {
    ctx.inject(["webServer"], (sctx) => {
      authContext = sctx;
      sctx.effect(() => {
        const off = register(sctx);
        return () => { try { off?.(); } catch {} };
      }, "spine: settings bridge");
    });
  } catch (error) {
    ctx.logger?.debug?.("spine: settings bridge unavailable: " + String(error?.message ?? error));
  }
}
