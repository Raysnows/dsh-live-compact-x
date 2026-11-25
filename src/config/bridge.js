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

/**
 * 面板「提交问题日志」用的脱敏诊断：版本、设置、开关、最近决策、目录体量。
 * 只读、不写盘；结果同时给「复制」和「去 issue」两个按钮。
 */
function buildDiagnostic(sid, getConfig) {
  const settings = describeSettings(getConfig(), presetLayerFor(sid));
  const numbers = Object.fromEntries(Object.entries(settings.effective || {})
    .filter(([, value]) => typeof value === "number")
    .map(([key, value]) => [key, value]));
  const dir = shadowDirectory();
  const shadow = directoryFootprint(dir);
  const decisions = readTailLines(join(dir, DECISIONS_NAME), 30)
    .map((line) => {
      try {
        const record = JSON.parse(line);
        return [
          String(record.ts || ""),
          record.sid ? "<id>" : "",
          record.phase || "",
          record.result || "",
          record.reason || "",
          Number.isFinite(record.totalTokens) ? "total=" + record.totalTokens : "",
          Number.isFinite(record.conversationTokens) ? "conv=" + record.conversationTokens : "",
          Number.isFinite(record.systemOverhead) ? "sys=" + record.systemOverhead : "",
          record.summarizer ? "summarizer=" + record.summarizer : "",
        ].filter(Boolean).join(" ");
      } catch {
        return "(unparsable decision line)";
      }
    });
  const lines = [
    "### 插件诊断（自动脱敏）",
    "- 插件版本：" + (settings.file ? "" : "") + versionText(),
    "- 宿主平台：" + process.platform + " / node " + process.version,
    "- 设置文件：" + (settings.file ? "~/" + String(settings.file).split(/[\\/]/).slice(-2).join("/") : "(none)"),
    "- 生效值：" + JSON.stringify(numbers),
    "- 总开关：" + JSON.stringify(switchSnapshot(sid)),
    "- 生效档：" + JSON.stringify(presetsSnapshot(sid).layer || null),
    "- shadow 目录：" + shadow.files + " 个文件 / " + (shadow.bytes / 1048576).toFixed(1) + "MB",
    "- 最近决策（最多 30 条）：",
    ...decisions.map((line) => "  - " + line),
  ];
  const text = sanitizeReport(lines.join("\n")).slice(0, 8000);
  const body = sanitizeReport("请描述现象与复现步骤（已自动附上脱敏诊断，可直接编辑删改）：\n\n" + text).slice(0, 6000);
  const url = ISSUE_URL + "?title=" + encodeURIComponent("[bug] ") + "&body=" + encodeURIComponent(body);
  return { text, url };
}

function versionText() {
  try {
    return String(JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8")).version || "");
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
