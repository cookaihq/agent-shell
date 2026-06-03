import { describe, it, expect } from 'vitest'
import { AgentEvent } from '../events'

describe('AgentEvent', () => {
  it('接受 tool_use 事件', () => {
    const e = AgentEvent.parse({ type: 'tool_use', id: 't1', name: 'Read', input: { path: 'a.ts' } })
    expect(e.type).toBe('tool_use')
  })

  it('接受带 cost 的 usage 事件', () => {
    expect(() =>
      AgentEvent.parse({ type: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.01 }),
    ).not.toThrow()
  })

  it('接受 turn_end 事件', () => {
    const e = AgentEvent.parse({ type: 'turn_end', stopReason: 'end_turn' })
    expect(e.type).toBe('turn_end')
  })

  it('拒绝未知事件类型', () => {
    expect(() => AgentEvent.parse({ type: 'nope' })).toThrow()
  })

  it('拒绝负的 token 计数', () => {
    expect(() => AgentEvent.parse({ type: 'usage', inputTokens: -1, outputTokens: 0 })).toThrow()
  })

  it('接受 thinking 阶段的 progress 事件', () => {
    const e = AgentEvent.parse({ type: 'progress', tokens: 42, activity: { kind: 'thinking' } })
    expect(e).toMatchObject({ type: 'progress', tokens: 42, activity: { kind: 'thinking' } })
  })

  it('接受带工具目标的 progress 事件', () => {
    expect(() =>
      AgentEvent.parse({ type: 'progress', tokens: 130, activity: { kind: 'tool', tool: 'Read', target: 'styles.css' } }),
    ).not.toThrow()
  })

  it('拒绝负的 progress.tokens', () => {
    expect(() => AgentEvent.parse({ type: 'progress', tokens: -1, activity: { kind: 'responding' } })).toThrow()
  })

  it('拒绝未知的 activity.kind', () => {
    expect(() => AgentEvent.parse({ type: 'progress', tokens: 1, activity: { kind: 'nope' } })).toThrow()
  })

  it('接受不带 target 的 tool progress 事件', () => {
    expect(() =>
      AgentEvent.parse({ type: 'progress', tokens: 5, activity: { kind: 'tool', tool: 'Bash' } }),
    ).not.toThrow()
  })

  it('接受 tokens 为 0 的 progress 事件（块刚开始时）', () => {
    expect(() =>
      AgentEvent.parse({ type: 'progress', tokens: 0, activity: { kind: 'thinking' } }),
    ).not.toThrow()
  })
})
