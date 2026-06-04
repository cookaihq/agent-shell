import { useEffect, useRef } from 'react'
import { AUTH_HEADER, AgentEvent as AgentEventSchema, type AgentShellBridge } from '@agent-shell/contracts'
import type { AgentEvent } from '../api/types'

// 为什么不用 EventSource：daemon 对所有 /api/* 设了「宽门 token gate」（server.ts），请求须带 AUTH_HEADER，
// 否则 503。而 EventSource 按 W3C 规范无法设置自定义请求头 → /stream 连接被门挡死 → 实时回复永不渲染。
// 改用 fetch + body.getReader() 手动读 SSE（fetch 能带头，复用 client.ts 同款 token 注入），与其余接口走同一鉴权路径。
// 借鉴 open-design apps/web/src/providers/api-proxy.ts 的流式消费方式。

// 从 AgentEvent 契约直接派生白名单——避免手维护列表与契约漂移（漏了 permission_request /
// ask_user_question / permission_resolved 会导致交互卡片永不出现、canUseTool 永久挂起 → 卡死）。
const EVENT_TYPES = new Set<string>(
  AgentEventSchema.options.map((o) => (o.shape.type as { value: string }).value),
)

/** 解析一帧 SSE（event: / data: 行）→ {event, data}；缺任一者（如 `: connected` 注释帧）→ null。 */
function parseFrame(frame: string): { event: string; data: string } | null {
  let event = ''
  let data = ''
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim()
    else if (line.startsWith('data:')) data += line.slice(5).trimStart()
  }
  if (!event || !data) return null
  return { event, data }
}

/** 跑一次 fetch 流：读到流结束 / 出错返回。abort 触发的错误静默吞掉（调用方据 signal 决定是否重连）。 */
async function pump(sessionId: string, signal: AbortSignal, dispatch: (ev: AgentEvent) => void): Promise<void> {
  const bridge = (globalThis as { agentShell?: AgentShellBridge }).agentShell
  const headers: Record<string, string> = {}
  if (bridge?.authToken) headers[AUTH_HEADER] = bridge.authToken

  const resp = await fetch(`/api/sessions/${sessionId}/stream`, { headers, signal })
  if (!resp.ok || !resp.body) return

  const reader = resp.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    let m: RegExpMatchArray | null
    while ((m = buf.match(/\r?\n\r?\n/)) && m.index !== undefined) {
      const frame = buf.slice(0, m.index)
      buf = buf.slice(m.index + m[0].length)
      const parsed = parseFrame(frame)
      if (!parsed || !EVENT_TYPES.has(parsed.event)) continue
      try { dispatch(JSON.parse(parsed.data) as AgentEvent) } catch { /* 坏帧跳过 */ }
    }
  }
}

export function useAgentStream(sessionId: string | null, onEvent: (ev: AgentEvent) => void, enabled: boolean): void {
  const cb = useRef(onEvent)
  cb.current = onEvent
  useEffect(() => {
    if (!sessionId || !enabled) return
    const ctrl = new AbortController()
    // 重连循环：流被对端关闭/网络抖动后重建（对齐 EventSource 自动重连）。abort 后停。
    // daemon 无回放，重连只为后续 turn 续上，不补当前 turn 丢的尾帧（与 EventSource 行为一致）。
    void (async () => {
      while (!ctrl.signal.aborted) {
        try {
          await pump(sessionId, ctrl.signal, (ev) => cb.current(ev))
        } catch { /* abort / 网络错误 → 下面判 signal 决定是否重连 */ }
        if (ctrl.signal.aborted) break
        await new Promise((r) => setTimeout(r, 1000))   // 退避后重连
      }
    })()
    return () => ctrl.abort()
  }, [sessionId, enabled])
}
