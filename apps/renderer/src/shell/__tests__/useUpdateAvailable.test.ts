import { renderHook, act } from '@testing-library/react'
import { describe, it, expect, afterEach } from 'vitest'
import type { UpdateState } from '@agent-shell/contracts'
import { useUpdateAvailable } from '../useUpdateAvailable'

afterEach(() => { delete (globalThis as { agentShell?: unknown }).agentShell })

describe('useUpdateAvailable', () => {
  it('无 bridge（浏览器/dev）→ 返回 null', () => {
    const { result } = renderHook(() => useUpdateAvailable())
    expect(result.current).toBeNull()
  })

  it('挂载时 getUpdateState 有值 → 返回该值', () => {
    ;(globalThis as Record<string, unknown>).agentShell = {
      getUpdateState: () => ({ version: '0.1.0', releasesUrl: 'https://x/releases' }),
      onUpdateAvailable: () => () => {},
    }
    const { result } = renderHook(() => useUpdateAvailable())
    expect(result.current).toEqual({ version: '0.1.0', releasesUrl: 'https://x/releases' })
  })

  it('onUpdateAvailable 推送 → 更新返回值', () => {
    let cb: ((s: UpdateState) => void) | null = null
    ;(globalThis as Record<string, unknown>).agentShell = {
      getUpdateState: () => null,
      onUpdateAvailable: (fn: (s: UpdateState) => void) => { cb = fn; return () => {} },
    }
    const { result } = renderHook(() => useUpdateAvailable())
    expect(result.current).toBeNull()
    act(() => { cb?.({ version: '0.2.0', releasesUrl: 'https://x/releases' }) })
    expect(result.current).toEqual({ version: '0.2.0', releasesUrl: 'https://x/releases' })
  })

  it('卸载时调用 unsub', () => {
    let unsubCalled = false
    ;(globalThis as Record<string, unknown>).agentShell = {
      getUpdateState: () => null,
      onUpdateAvailable: () => () => { unsubCalled = true },
    }
    const { unmount } = renderHook(() => useUpdateAvailable())
    unmount()
    expect(unsubCalled).toBe(true)
  })

  it('先订阅后查询：onUpdateAvailable 注册早于 getUpdateState 调用', () => {
    const calls: string[] = []
    ;(globalThis as Record<string, unknown>).agentShell = {
      getUpdateState: () => { calls.push('get'); return null },
      onUpdateAvailable: () => { calls.push('sub'); return () => {} },
    }
    renderHook(() => useUpdateAvailable())
    expect(calls).toEqual(['sub', 'get'])
  })
})
