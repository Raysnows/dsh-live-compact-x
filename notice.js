/**
 * 宿主注入的上下文消息识别。
 *
 * DSH 会把一批「不是用户说的话」也写成 user/message 事件：时间戳、运行环境、技能目录、
 * 后台任务通知、校验提醒，以及 PTC 工具结果（图片/文件内容）。上游把它们当成用户边界，
 * 本地模式的小刀于是永远切不动——实测一个会话里这类消息有 30 条，占全部 user 消息的七成。
 * 这里只认宿主的这些确切 source.kind + form；未知来源（含第三方插件伪造的）仍按用户墙处理。
 *
 * Host-injected context arrives as user/message events. Only these exact kinds qualify;
 * anything unknown stays a hard user boundary. A real user message (kind "user") and an
 * approval action (kind "user-approval") remain boundaries.
 */

export const HOST_CONTEXT_KINDS = new Set([
  "time-context", // 时间戳快照
  "runtime-context", // 运行环境快照
  "skill-catalog", // 技能目录
  "subagent-settled", // 子代理完成通知
  "tool-jobs", // 后台任务通知
  "verify-gate", // 校验提醒
  "ptc-mode", // PTC 工具结果（图片/文件内容）被包成 user 消息
]);

const FORMS = new Set(["snapshot", "catalog", "notice"]);

export function hostContextNotice(event, source) {
  if (event?.type !== "user/message") return false;
  const kind = source?.kind;
  if (!HOST_CONTEXT_KINDS.has(kind)) return false;
  // 有的 kind 不带 form（verify-gate / ptc-mode），带 form 的必须是宿主那三种之一。
  if (source?.form === undefined) return true;
  return FORMS.has(source.form);
}
