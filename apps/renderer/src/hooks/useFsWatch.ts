import { useEffect, useRef } from 'react'
import { AUTH_HEADER, type AgentShellBridge } from '@agent-shell/contracts'

// 订阅 daemon 的项目目录变更推送（Issue 19）。与 useAgentStream 同款：fetch + getReader 手动读 SSE
// （EventSource 无法带 AUTH_HEADER，会被 daemon 宽门挡死）。收到 files-changed 帧即回调，调用方自行防抖重拉。

async function pump(projectId: string, signal: AbortSignal, onChange: () => void): Promise<void> {
  const bridge = (globalThis as { agentShell?: AgentShellBridge }).agentShell
  const headers: Record<string, string> = {}
  if (bridge?.authToken) headers[AUTH_HEADER] = bridge.authToken
  const resp = await fetch(`/api/projects/${projectId}/fs-stream`, { headers, signal })
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
      if (frame.includes('files-changed')) onChange()
    }
  }
}

export function useFsWatch(projectId: string | null, onChange: () => void): void {
  const cb = useRef(onChange)
  cb.current = onChange
  useEffect(() => {
    if (!projectId) return
    const ctrl = new AbortController()
    void (async () => {
      while (!ctrl.signal.aborted) {
        try { await pump(projectId, ctrl.signal, () => cb.current()) }
        catch { /* abort / 网络错误 → 退避重连 */ }
        if (ctrl.signal.aborted) break
        await new Promise((r) => setTimeout(r, 1000))
      }
    })()
    return () => ctrl.abort()
  }, [projectId])
}
