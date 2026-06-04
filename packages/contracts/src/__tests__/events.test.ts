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

  // ── SDK 交互回路：逐工具授权 + AskUserQuestion + 解决/撤销 ──────────────────
  it('接受 permission_request 事件（带 requestId/toolName/input + 可选展示字段）', () => {
    const e = AgentEvent.parse({
      type: 'permission_request', requestId: 'r1', toolName: 'Write',
      input: { file_path: 'a.ts' }, title: 'Claude wants to write a.ts', displayName: 'Write file',
    })
    expect(e).toMatchObject({ type: 'permission_request', requestId: 'r1', toolName: 'Write' })
  })

  it('permission_request 缺 requestId → 拒绝', () => {
    expect(() => AgentEvent.parse({ type: 'permission_request', toolName: 'Write', input: {} })).toThrow()
  })

  it('接受 ask_user_question 事件（questions[].options[]）', () => {
    const e = AgentEvent.parse({
      type: 'ask_user_question', requestId: 'q1',
      questions: [{ question: '选哪个？', header: '方案', multiSelect: false, options: [{ label: 'A', description: '甲' }, { label: 'B' }] }],
    })
    expect(e).toMatchObject({ type: 'ask_user_question', requestId: 'q1' })
  })

  it('接受 permission_resolved 事件（清 UI：allow/deny/cancelled）', () => {
    for (const outcome of ['allow', 'deny', 'cancelled']) {
      expect(() => AgentEvent.parse({ type: 'permission_resolved', requestId: 'r1', outcome })).not.toThrow()
    }
    expect(() => AgentEvent.parse({ type: 'permission_resolved', requestId: 'r1', outcome: 'nope' })).toThrow()
  })

  it('turn_end 可带 sdkMessageId/sdkUuid', () => {
    const ev = { type: 'turn_end', stopReason: 'end_turn', sdkMessageId: 'msg_1', sdkUuid: 'u1' }
    expect(AgentEvent.parse(ev)).toMatchObject({ sdkMessageId: 'msg_1', sdkUuid: 'u1' })
  })
})
