// tabUnread.test.ts — 两套 Tab 未读语义 hook（feedback-2 Issue 11）
import { renderHook } from '@testing-library/react'
import { describe, it, expect, beforeEach } from 'vitest'
import { useTabUnread, statusDotClass } from '../tabUnread'

const KEY = 'agent-shell:tab-seen:project'
beforeEach(() => { try { localStorage.clear() } catch { /* noop */ } })

describe('statusDotClass', () => {
  it('running 优先（amber 脉冲），其余按终态映射', () => {
    expect(statusDotClass('completed', true)).toBe('st-running')  // 运行优先
    expect(statusDotClass('failed', false)).toBe('st-failed')
    expect(statusDotClass('completed', false)).toBe('st-done')
    expect(statusDotClass('idle', false)).toBe('st-neutral')
    expect(statusDotClass('aborted', false)).toBe('st-neutral')
  })
})

describe('useTabUnread', () => {
  it('首次见到的终态 → 建已读基线、不亮（避免升级时历史 completed 全亮）', () => {
    const { result } = renderHook(() => useTabUnread('project', [{ id: 'a', status: 'completed' }], null))
    expect(result.current.isUnread('a', 'completed')).toBe(false)
  })

  it('运行态 / 失败不入未读门（由调用方恒显，不经本 hook）', () => {
    const { result } = renderHook(() => useTabUnread('project', [{ id: 'a', status: 'failed' }], null))
    expect(result.current.isUnread('a', 'failed')).toBe(false)
    expect(result.current.isUnread('a', 'running')).toBe(false)
  })

  it('跨重启：localStorage 旧指纹（idle）≠ 当前终态（completed）→ 亮', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 'idle' }))
    const { result } = renderHook(() => useTabUnread('project', [{ id: 'a', status: 'completed' }], null))
    expect(result.current.isUnread('a', 'completed')).toBe(true)
  })

  it('打开（active）→ 标已读、不亮，且持久指纹更新为当前 status', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 'idle' }))
    const { result } = renderHook(() => useTabUnread('project', [{ id: 'a', status: 'completed' }], 'a'))
    expect(result.current.isUnread('a', 'completed')).toBe(false)
    expect(JSON.parse(localStorage.getItem(KEY)!).a).toBe('completed')
  })

  it('运行期跳变进终态（非 active）→ 亮（同值重亮靠跳变 Set）', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 'idle' }))
    const { result, rerender } = renderHook(
      ({ items, active }: { items: { id: string; status: string }[]; active: string | null }) =>
        useTabUnread('project', items, active),
      { initialProps: { items: [{ id: 'a', status: 'idle' }], active: null as string | null } },
    )
    expect(result.current.isUnread('a', 'idle')).toBe(false)   // idle == 指纹 idle → 不亮
    rerender({ items: [{ id: 'a', status: 'completed' }], active: null })
    expect(result.current.isUnread('a', 'completed')).toBe(true)   // 跳变进 completed → 亮
  })
})
