import { describe, it, expect } from 'vitest'
import { initSubagentState, subagentReduce, type SubagentState } from '../subagent'
import type { AgentEvent } from '../../../../api/types'

/**
 * claude 切片私有 subagent reducer（spec §6 Phase 2 平移自 chatReducer 'subagent' case）。
 * 断言与原 chatReducer.test 一致，仅状态源从 ChatState.subagents 改为切片私有 SubagentState。
 */
const ev = (e: Partial<AgentEvent> & { type: 'subagent' }): AgentEvent => e as AgentEvent

describe('subagentReduce — 子代理生命周期累计', () => {
  it('started/progress/ended → 累计为一条 meta（status 终态、usage 实时）', () => {
    let s: SubagentState = initSubagentState()
    s = subagentReduce(s, ev({ type: 'subagent', phase: 'started', taskId: 'tk1', toolUseId: 'tu1', subagentType: 'general-purpose', description: 'do x' }))
    s = subagentReduce(s, ev({ type: 'subagent', phase: 'progress', taskId: 'tk1', toolUseId: 'tu1', usage: { totalTokens: 120, toolUses: 3, durationMs: 4500 }, lastToolName: 'Read' }))
    expect(s['tu1']).toMatchObject({ taskId: 'tk1', subagentType: 'general-purpose', status: 'running', usage: { totalTokens: 120 } })
    s = subagentReduce(s, ev({ type: 'subagent', phase: 'ended', taskId: 'tk1', toolUseId: 'tu1', status: 'completed' }))
    expect(s['tu1'].status).toBe('completed')
  })

  it('R2 根治：同一子代理 tool_use_id 时有时无 → 不分裂、仍可经 toolUseId 命中', () => {
    let s: SubagentState = initSubagentState()
    // started 带 toolUseId；progress / ended 不带（SDK tool_use_id 三类皆 optional，sdk.d.ts L3655/3673/3695）
    s = subagentReduce(s, ev({ type: 'subagent', phase: 'started', taskId: 'tk1', toolUseId: 'tu1', subagentType: 'general-purpose', description: 'do x' }))
    s = subagentReduce(s, ev({ type: 'subagent', phase: 'progress', taskId: 'tk1', usage: { totalTokens: 10, toolUses: 1, durationMs: 100 } }))
    s = subagentReduce(s, ev({ type: 'subagent', phase: 'ended', taskId: 'tk1', status: 'completed' }))
    // 去重后只有 1 个子代理（按 taskId）
    const uniq = new Set(Object.values(s).map((m) => m.taskId))
    expect(uniq.size).toBe(1)
    // progress 的 usage 合并进同一条、终态生效
    expect(s['tk1']).toMatchObject({ status: 'completed', usage: { totalTokens: 10 } })
    // 仍可经 toolUseId（= ChatLog 用的 Task block id）命中同一条
    expect(s['tu1']).toBe(s['tk1'])
  })

  it('非 subagent 事件原样返回（外壳已先处理共享事件）', () => {
    const s: SubagentState = initSubagentState()
    const next = subagentReduce(s, { type: 'turn_start' } as AgentEvent)
    expect(next).toBe(s)
  })
})
