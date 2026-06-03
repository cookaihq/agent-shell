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
})
