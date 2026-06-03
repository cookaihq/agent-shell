import type { AgentEvent } from '@agent-shell/contracts'

/** tool_result 内容字符上限（默认）。工程取舍、非计费，可调；命令输出可达 MB，统一在此截。 */
export const TRUNCATE_LIMIT = 16_000

function truncateContent(s: string, limit: number): string {
  if (s.length <= limit) return s
  return s.slice(0, limit) + `\n…[truncated ${s.length - limit} chars]`
}

/** 在事件流向 SSE / 落库前统一施加截断；仅作用于 tool_result.content，其余事件原样（引用不变）。 */
export function truncateEvent(ev: AgentEvent, limit: number = TRUNCATE_LIMIT): AgentEvent {
  if (ev.type === 'tool_result' && ev.content.length > limit) {
    return { ...ev, content: truncateContent(ev.content, limit) }
  }
  return ev
}
