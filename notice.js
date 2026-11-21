/**
 * 宿主注入的上下文快照识别。
 *
 * DSH 每轮/每 N 步都会以 user/message 的形式补一条上下文：时间、运行环境、技能目录。
 * 这些不是用户说的话，但上游把它们当成「最新的用户边界」，本地模式的小刀因此永远切不动
 * （实测：一个 142k 的会话，一次都没压）。这里只认宿主的三个确切 source.kind + form，
 * 未知来源（包括第三方插件伪造的）仍然按用户墙处理。
 *
 * Host-injected context snapshots arrive as user/message events. Only these exact
 * host kinds forms qualify; anything unknown stays a hard user boundary.
 */

export const HOST_CONTEXT_KINDS = new Set(["time-context", "runtime-context", "skill-catalog"]);

export function hostContextNotice(event, source) {
  if (event?.type !== "user/message") return false;
  if (!HOST_CONTEXT_KINDS.has(source?.kind)) return false;
  return source?.form === "snapshot" || source?.form === "catalog";
}
