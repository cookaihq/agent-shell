import type { AgentEvent } from '@agent-shell/contracts'

/** tool_result 内容字符上限（默认）。工程取舍、非计费，可调；命令输出可达 MB，统一在此截。 */
export const TRUNCATE_LIMIT = 16_000

function truncateContent(s: string, limit: number): string {
  if (s.length <= limit) return s
  return s.slice(0, limit) + `\n…[truncated ${s.length - limit} chars]`
}

/**
 * 在事件流向 SSE / 落库前统一施加截断；其余事件原样（引用不变）。作用面：
 *   - 共享 tool_result.content；
 *   - codex 子线程 tool_result（封在 codex_subagent.item，kind:'tool_result'）的 item.content——
 *     外层 type 是 codex_subagent，共享 tool_result 分支够不到它，故单列一支用同一上限 + 同一省略标记。
 *     其余 codex_subagent phase（message/thinking/spawned/status/report/wait/closed/tool_use）不动。
 */
export function truncateEvent(ev: AgentEvent, limit: number = TRUNCATE_LIMIT): AgentEvent {
  if (ev.type === 'tool_result' && ev.content.length > limit) {
    return { ...ev, content: truncateContent(ev.content, limit) }
  }
  if (
    ev.type === 'codex_subagent' && ev.phase === 'item' &&
    ev.item?.kind === 'tool_result' && ev.item.content.length > limit
  ) {
    return { ...ev, item: { ...ev.item, content: truncateContent(ev.item.content, limit) } }
  }
  return ev
}
