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
import { readFileSync } from "node:fs";
import { describeSettings, writeOverrides } from "./settings.js";
import { setSwitchState, switchSnapshot } from "./switch.js";
import { activePresetFor, applyPreset, deletePreset, presetLayerFor, presetsSnapshot, savePreset } from "./presets.js";

export const BRIDGE_PREFIX = "/api/dsh-live-compact-x-settings";

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
