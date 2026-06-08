import { describe, it, expect } from 'vitest'
import {
  initCodexSubagentState,
  codexSubagentReduce,
  subsByParent,
  isWaiting,
  CXP_STAT,
  type CodexSubagentState,
} from '../subagentView'
import type { AgentEvent } from '../../../../api/types'

/**
 * codex 切片私有 subagent reducer（spec §4.2/§6）：threadId 索引的多 thread 模型，
 * 与 claude（taskId 单流）本质不同。喂一串 CodexSubagentEvent，断言 threadId 索引态。
 */
const ev = (e: Partial<AgentEvent> & { type: 'codex_subagent' }): AgentEvent => e as AgentEvent

const MAIN = 'main-thread'
const SUB_A = 'sub-a'
const SUB_B = 'sub-b'

describe('codexSubagentReduce — threadId 索引的多 thread 累计', () => {
  it('spawned×2 同父 → 两条子代理条目，按 parentThreadId 归到同一父组', () => {
    let s: CodexSubagentState = initCodexSubagentState()
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_A, parentThreadId: MAIN, task: '写 AAA.txt' }))
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_B, parentThreadId: MAIN, task: '写 BBB.txt' }))
    expect(s.subs[SUB_A]).toMatchObject({ threadId: SUB_A, parentThreadId: MAIN, task: '写 AAA.txt', status: 'pendingInit', items: [] })
    expect(s.subs[SUB_B]).toMatchObject({ threadId: SUB_B, parentThreadId: MAIN, task: '写 BBB.txt' })
    const group = subsByParent(s, MAIN)
    expect(group.map((g) => g.threadId)).toEqual([SUB_A, SUB_B])
  })

  it('item → 追加到对应 threadId 的 items（归属正确，不串线）', () => {
    let s: CodexSubagentState = initCodexSubagentState()
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_A, parentThreadId: MAIN, task: 'A' }))
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_B, parentThreadId: MAIN, task: 'B' }))
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'item', threadId: SUB_A, item: { kind: 'thinking', text: '想 A' } }))
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'item', threadId: SUB_A, item: { kind: 'tool_use', id: 't1', name: 'shell', input: {}, tool: 'bash' } }))
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'item', threadId: SUB_B, item: { kind: 'thinking', text: '想 B' } }))
    expect(s.subs[SUB_A].items).toHaveLength(2)
    expect(s.subs[SUB_B].items).toHaveLength(1)
    expect(s.subs[SUB_A].items[1]).toMatchObject({ kind: 'tool_use', id: 't1' })
  })

  it('item 流式 message → 替换当前流式块（streaming 语义），定格 message → 追加', () => {
    let s: CodexSubagentState = initCodexSubagentState()
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_A, parentThreadId: MAIN, task: 'A' }))
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'item', threadId: SUB_A, item: { kind: 'message', text: '你', streaming: true } }))
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'item', threadId: SUB_A, item: { kind: 'message', text: '你好', streaming: true } }))
    // 流式累计帧替换，不堆叠
    expect(s.subs[SUB_A].items).toHaveLength(1)
    expect(s.subs[SUB_A].items[0]).toMatchObject({ kind: 'message', text: '你好', streaming: true })
    // 定格帧：落定当前流式块（变成非流式），不再新增
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'item', threadId: SUB_A, item: { kind: 'message', text: '你好世界' } }))
    expect(s.subs[SUB_A].items).toHaveLength(1)
    expect(s.subs[SUB_A].items[0]).toMatchObject({ kind: 'message', text: '你好世界' })
    expect((s.subs[SUB_A].items[0] as any).streaming).toBeFalsy()
  })

  it('status → 更新对应子代理状态', () => {
    let s: CodexSubagentState = initCodexSubagentState()
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_A, parentThreadId: MAIN, task: 'A' }))
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'status', threadId: SUB_A, status: 'running' }))
    expect(s.subs[SUB_A].status).toBe('running')
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'status', threadId: SUB_A, status: 'completed' }))
    expect(s.subs[SUB_A].status).toBe('completed')
  })

  it('status 先到（spawned 还没来）→ 自建占位条目，spawned 再补 parent/task', () => {
    let s: CodexSubagentState = initCodexSubagentState()
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'status', threadId: SUB_A, status: 'pendingInit' }))
    expect(s.subs[SUB_A]).toMatchObject({ threadId: SUB_A, status: 'pendingInit' })
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_A, parentThreadId: MAIN, task: 'A' }))
    expect(s.subs[SUB_A]).toMatchObject({ parentThreadId: MAIN, task: 'A', status: 'pendingInit' })
  })

  it('report → 设到对应子代理的 report', () => {
    let s: CodexSubagentState = initCodexSubagentState()
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_A, parentThreadId: MAIN, task: 'A' }))
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'report', threadId: SUB_A, report: '汇报：已完成 AAA.txt' }))
    expect(s.subs[SUB_A].report).toBe('汇报：已完成 AAA.txt')
  })

  it('wait → 设主 thread 的 waiting 标志（驱动 cxp-wait 徽章），started→true / completed→false', () => {
    let s: CodexSubagentState = initCodexSubagentState()
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'wait', threadId: MAIN, parentThreadId: MAIN, waiting: true }))
    expect(isWaiting(s, MAIN)).toBe(true)
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'wait', threadId: MAIN, parentThreadId: MAIN, waiting: false }))
    expect(isWaiting(s, MAIN)).toBe(false)
  })

  it('closed → 标记子代理已关闭（status=shutdown 兜底，若已是终态则不覆盖）', () => {
    let s: CodexSubagentState = initCodexSubagentState()
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_A, parentThreadId: MAIN, task: 'A' }))
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'status', threadId: SUB_A, status: 'completed' }))
    s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'closed', threadId: SUB_A }))
    // 已 completed 的终态不被 closed 覆盖
    expect(s.subs[SUB_A].status).toBe('completed')
    expect(s.subs[SUB_A].closed).toBe(true)
  })

  it('非 codex_subagent 事件原样返回（外壳已先处理共享事件）', () => {
    const s = initCodexSubagentState()
    const next = codexSubagentReduce(s, { type: 'turn_start' } as AgentEvent)
    expect(next).toBe(s)
  })

  it('reduce 是纯函数：返回新引用，不改旧 state', () => {
    const s0 = initCodexSubagentState()
    const s1 = codexSubagentReduce(s0, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_A, parentThreadId: MAIN, task: 'A' }))
    expect(s1).not.toBe(s0)
    expect(s0.subs[SUB_A]).toBeUndefined()
  })

  it('CXP_STAT 覆盖全部 CodexSubStatus 六态', () => {
    for (const st of ['pendingInit', 'running', 'completed', 'interrupted', 'errored', 'shutdown'] as const) {
      expect(CXP_STAT[st]).toBeDefined()
      expect(typeof CXP_STAT[st].cls).toBe('string')
    }
  })
})
