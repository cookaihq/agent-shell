import { useEffect, useRef } from 'react'
import { z, AUTH_HEADER, SharedLifecycleEvent, type AgentShellBridge, type Engine, type ZodTypeAny } from '@agent-shell/contracts'
import type { AgentEvent } from '../api/types'
import { getSlice } from '../workspace/agents/registry'

// 为什么不用 EventSource：daemon 对所有 /api/* 设了「宽门 token gate」（server.ts），请求须带 AUTH_HEADER，
// 否则 503。而 EventSource 按 W3C 规范无法设置自定义请求头 → /stream 连接被门挡死 → 实时回复永不渲染。
// 改用 fetch + body.getReader() 手动读 SSE（fetch 能带头，复用 client.ts 同款 token 注入），与其余接口走同一鉴权路径。
// 借鉴 open-design apps/web/src/providers/api-proxy.ts 的流式消费方式。

// 消费层不认全量事件词表（隔离 §4.5）：按当前会话 engine 取「共享生命周期 ∪ 该切片私有 schema」对帧 data 做
// zod safeParse，成功才分发、失败/未知帧丢弃——保住防卡死语义（permission_request / ask_user_question /
// permission_resolved 归 claude 切片 schema，claude 会话必过；坏帧不会卡住 canUseTool）。
// 注意（§4.5 deferred）：本期不做 frame-name 前缀隔离（claude:subagent 等）——当前事件名无冲突，
// 且这里 safeParse 的是 data 对象而非 frame 名，按 type 判别已足够。

/** 按 engine 组装接受 schema：有切片私有 schema → 共享 ∪ 私有；缺省（如 codex / 无 engine）→ 仅共享。 */
function acceptSchema(engine?: Engine): ZodTypeAny {
  const sliceSchema = engine ? getSlice(engine).eventSchema : undefined
  return sliceSchema ? z.union([SharedLifecycleEvent, sliceSchema]) : SharedLifecycleEvent
}

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
async function pump(sessionId: string, signal: AbortSignal, accept: ZodTypeAny, dispatch: (ev: AgentEvent) => void): Promise<void> {
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
      if (!parsed) continue   // `: connected` 注释帧等
      let obj: unknown
      try { obj = JSON.parse(parsed.data) } catch { continue }   // 非 JSON 坏帧丢弃
      const r = accept.safeParse(obj)
      if (r.success) dispatch(r.data as AgentEvent)   // 未知/不合法帧丢弃 → 不卡 canUseTool
    }
  }
}

export function useAgentStream(sessionId: string | null, onEvent: (ev: AgentEvent) => void, enabled: boolean, engine?: Engine): void {
  const cb = useRef(onEvent)
  cb.current = onEvent
  useEffect(() => {
    if (!sessionId || !enabled) return
    const ctrl = new AbortController()
    const accept = acceptSchema(engine)   // 只依赖 engine，每次 effect 算一次
    // 重连循环：流被对端关闭/网络抖动后重建（对齐 EventSource 自动重连）。abort 后停。
    // daemon 无回放，重连只为后续 turn 续上，不补当前 turn 丢的尾帧（与 EventSource 行为一致）。
    void (async () => {
      while (!ctrl.signal.aborted) {
        try {
          await pump(sessionId, ctrl.signal, accept, (ev) => cb.current(ev))
        } catch { /* abort / 网络错误 → 下面判 signal 决定是否重连 */ }
        if (ctrl.signal.aborted) break
        await new Promise((r) => setTimeout(r, 1000))   // 退避后重连
      }
    })()
    return () => ctrl.abort()
  }, [sessionId, enabled, engine])
}
