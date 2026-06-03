import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'
import { AUTH_HEADER } from '@agent-shell/contracts'
import { useAgentStream } from '../useAgentStream'

// 把若干 SSE 帧编码成一个 ReadableStream 体；读完即 done（不再触发重连，循环里 setTimeout 后才重连）。
function streamBody(frames: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder()
  let i = 0
  return new ReadableStream<Uint8Array>({
    pull(ctrl) {
      if (i < frames.length) ctrl.enqueue(enc.encode(frames[i++]))
      else ctrl.close()
    },
  })
}

function sse(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  fetchMock = vi.fn(async () => ({ ok: true, body: streamBody([]) }) as unknown as Response)
  vi.stubGlobal('fetch', fetchMock)
  delete (globalThis as { agentShell?: unknown }).agentShell
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('useAgentStream', () => {
  it('enabled 时 fetch /api/sessions/:id/stream 并分发命名事件', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      body: streamBody([
        ': connected\n\n',                                  // 注释帧 → 跳过
        sse('message', { type: 'message', text: 'A' }),
        sse('turn_end', { type: 'turn_end', stopReason: 'end_turn' }),
      ]),
    }) as unknown as Response)

    const evs: unknown[] = []
    renderHook(() => useAgentStream('s1', (e) => evs.push(e), true))

    await waitFor(() => expect(evs).toHaveLength(2))
    expect(fetchMock.mock.calls[0][0]).toBe('/api/sessions/s1/stream')
    expect(evs).toEqual([
      { type: 'message', text: 'A' },
      { type: 'turn_end', stopReason: 'end_turn' },
    ])
  })

  it('有 bridge token 时带 AUTH_HEADER 请求头', async () => {
    ;(globalThis as { agentShell?: unknown }).agentShell = { authToken: 'tok123' }
    renderHook(() => useAgentStream('s1', () => {}, true))
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect((init.headers as Record<string, string>)[AUTH_HEADER]).toBe('tok123')
  })

  it('跨帧边界切分（半帧 chunk 也能拼回）', async () => {
    fetchMock.mockImplementationOnce(async () => ({
      ok: true,
      // 把一帧拆成两个 chunk，验证缓冲拼接
      body: streamBody(['event: message\ndata: {"type":"mess', 'age","text":"X"}\n\n']),
    }) as unknown as Response)
    const evs: unknown[] = []
    renderHook(() => useAgentStream('s1', (e) => evs.push(e), true))
    await waitFor(() => expect(evs).toEqual([{ type: 'message', text: 'X' }]))
  })

  it('enabled=false 不发请求', () => {
    renderHook(() => useAgentStream('s1', () => {}, false))
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('卸载时 abort（fetch 收到的 signal 被中止）', async () => {
    renderHook(() => useAgentStream('s1', () => {}, true)).unmount()
    await waitFor(() => expect(fetchMock).toHaveBeenCalled())
    const init = fetchMock.mock.calls[0][1] as RequestInit
    expect(init.signal?.aborted).toBe(true)
  })
})
