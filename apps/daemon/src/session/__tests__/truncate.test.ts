import { describe, it, expect } from 'vitest'
import { TRUNCATE_LIMIT, truncateEvent } from '../truncate'
import type { AgentEvent } from '@agent-shell/contracts'

describe('truncate', () => {
  it('tool_result.content 超限 → 截断 + 标记', () => {
    const big = 'x'.repeat(TRUNCATE_LIMIT + 500)
    const ev = truncateEvent({ type: 'tool_result', toolUseId: 't', ok: true, content: big })
    expect(ev.type).toBe('tool_result')
    if (ev.type === 'tool_result') {
      expect(ev.content.length).toBeLessThan(big.length)
      expect(ev.content).toContain('[truncated 500 chars]')
    }
  })
  it('tool_result.content 未超限 → 原样', () => {
    const ev = truncateEvent({ type: 'tool_result', toolUseId: 't', ok: true, content: 'short' })
    expect(ev).toMatchObject({ content: 'short' })
  })
  it('非 tool_result 事件 → 原样返回', () => {
    const msg: AgentEvent = { type: 'message', text: 'hi' }
    expect(truncateEvent(msg)).toBe(msg)
  })

  it('codex_subagent 子线程 tool_result.item.content 超限 → 截断 + 同款标记', () => {
    const big = 'y'.repeat(TRUNCATE_LIMIT + 500)
    const ev = truncateEvent({
      type: 'codex_subagent', phase: 'item', threadId: 'sub-a',
      item: { kind: 'tool_result', toolUseId: 't1', ok: true, content: big },
    })
    expect(ev.type).toBe('codex_subagent')
    if (ev.type === 'codex_subagent' && ev.item?.kind === 'tool_result') {
      expect(ev.item.content.length).toBeLessThan(big.length)
      expect(ev.item.content).toContain('[truncated 500 chars]')
    }
  })

  it('codex_subagent 子线程 tool_result 未超限 → 原样（content 不变）', () => {
    const ev = truncateEvent({
      type: 'codex_subagent', phase: 'item', threadId: 'sub-a',
      item: { kind: 'tool_result', toolUseId: 't1', ok: true, content: 'short' },
    })
    if (ev.type === 'codex_subagent' && ev.item?.kind === 'tool_result') {
      expect(ev.item.content).toBe('short')
    }
  })

  it('codex_subagent 非 tool_result 帧（message/spawned 等）→ 原样返回（不误截）', () => {
    const bigMsg = 'z'.repeat(TRUNCATE_LIMIT + 100)
    const msgEv: AgentEvent = {
      type: 'codex_subagent', phase: 'item', threadId: 'sub-a',
      item: { kind: 'message', text: bigMsg },
    }
    expect(truncateEvent(msgEv)).toBe(msgEv)   // message item 不在截断面 → 同引用
    const spawnedEv: AgentEvent = { type: 'codex_subagent', phase: 'spawned', threadId: 'sub-a', parentThreadId: 'main' }
    expect(truncateEvent(spawnedEv)).toBe(spawnedEv)
  })
})
