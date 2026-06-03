import { AgentEvent } from '@agent-shell/contracts'

/** 构造的事件先过 AgentEvent 校验，非法则丢弃——解析器作为归一边界，绝不向下游放出坏事件。 */
export function emit(out: AgentEvent[], ev: unknown): void {
  const r = AgentEvent.safeParse(ev)
  if (r.success) out.push(r.data)
}
