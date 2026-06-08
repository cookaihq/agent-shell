import { describe, it, expect } from 'vitest'
import { render } from '@testing-library/react'
import { initCodexSubagentState, codexSubagentReduce, type CodexSubagentState } from '../subagentView'
import { timelineMount, headerEntry, rightViews } from '../subagent'
import type { AgentEvent, Block } from '../../../../api/types'
import type { SaCtx, SliceViewCtx } from '../../types'
import { buildResultMap, buildChildrenMap } from '../../../timeline'

/**
 * codex 切片三挂载（形态 A cxp-group / 形态 B cxp-board / 形态 C cxp-entry）组件渲染断言。
 * 镜像原型 workspace.html 的 cxp-* 结构。
 */
const ev = (e: Partial<AgentEvent> & { type: 'codex_subagent' }): AgentEvent => e as AgentEvent

const MAIN = 'main-thread'
const SUB_A = 'sub-a'
const SUB_B = 'sub-b'

/** 造一个「两子代理（A 完成带汇报、B 运行中）+ 主代理 wait」的典型态。 */
function buildState(): CodexSubagentState {
  let s = initCodexSubagentState()
  s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_A, parentThreadId: MAIN, task: '写 AAA.txt\n（次行被截）' }))
  s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'spawned', threadId: SUB_B, parentThreadId: MAIN, task: '写 BBB.txt' }))
  s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'item', threadId: SUB_A, item: { kind: 'message', text: '在目录创建 AAA.txt' } }))
  s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'item', threadId: SUB_A, item: { kind: 'tool_use', id: 'c1', name: 'shell', input: { command: 'echo AAA > AAA.txt' }, tool: 'bash' } }))
  s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'item', threadId: SUB_A, item: { kind: 'tool_result', toolUseId: 'c1', ok: true, content: '' } }))
  s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'status', threadId: SUB_A, status: 'completed' }))
  s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'report', threadId: SUB_A, report: '汇报：已完成 AAA.txt' }))
  s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'status', threadId: SUB_B, status: 'running' }))
  s = codexSubagentReduce(s, ev({ type: 'codex_subagent', phase: 'wait', threadId: MAIN, parentThreadId: MAIN, waiting: true }))
  return s
}

/** 形态A 锚点块（daemon emit 的主线 tool_use，input.parentThreadId=主）。 */
const anchorBlock: Extract<Block, { type: 'tool_use' }> = {
  type: 'tool_use', id: `spawnAgent:${MAIN}`, name: 'spawnAgent', input: { parentThreadId: MAIN },
}

function saCtx(sliceState: CodexSubagentState, blocks: Block[]): SaCtx {
  return { resultMap: buildResultMap(blocks), childrenOf: buildChildrenMap(blocks), sliceState, mountTask: timelineMount }
}

describe('codex 形态A — timelineMount（cxp-group 内联并发组）', () => {
  it('spawnAgent 锚点块 → 渲染 codex-pool，每个并发子代理一个 cxp-agent 行 + wait 徽章', () => {
    const s = buildState()
    const ctx = saCtx(s, [anchorBlock])
    const { container } = render(<>{timelineMount(anchorBlock, ctx)}</>)
    expect(container.querySelector('.codex-pool')).not.toBeNull()
    // 两个并发子代理 → 两个 cxp-agent
    expect(container.querySelectorAll('.cxp-agent')).toHaveLength(2)
    // 头部标题含「2」并发数；wait 徽章在场
    expect(container.querySelector('.cxp-title')?.textContent).toContain('2')
    expect(container.querySelector('.cxp-wait')).not.toBeNull()
    // 子 A 完成 → done 状态点；子 A 汇报在场
    expect(container.querySelector('.cxp-stat.done')).not.toBeNull()
    expect(container.querySelector('.cxp-report')?.textContent).toContain('已完成 AAA.txt')
    // 并发导轨
    expect(container.querySelector('.cxp-rail')).not.toBeNull()
  })

  it('非 spawnAgent 块 / 无子代理的父 → timelineMount 返回 undefined（外壳正常渲染该块）', () => {
    const s = buildState()
    const other: Extract<Block, { type: 'tool_use' }> = { type: 'tool_use', id: 'x', name: 'Read', input: {} }
    expect(timelineMount(other, saCtx(s, [other]))).toBeUndefined()
    // 父下无子代理（空 state）→ 锚点块也不渲染（返回 null → 节点消失）
    const empty = initCodexSubagentState()
    expect(timelineMount(anchorBlock, saCtx(empty, [anchorBlock]))).toBeNull()
  })

  it('mini-timeline 用中立 .tl-item 渲染子线程 item（message/tool_use）', () => {
    const s = buildState()
    const { container } = render(<>{timelineMount(anchorBlock, saCtx(s, [anchorBlock]))}</>)
    // 子 A 展开（默认 open 完成的）→ 其 mini-timeline 有 tl-item
    expect(container.querySelectorAll('.cxp-inner .chat-timeline .tl-item').length).toBeGreaterThan(0)
  })
})

describe('codex 形态C — headerEntry（cxp-entry ⬢ 头像堆叠）', () => {
  it('有并发子代理 → 渲染 cxp-entry，每个子代理一个 ⬢ 头像', () => {
    const s = buildState()
    const ctx: SliceViewCtx = { sliceState: s, blocks: [] }
    const { container } = render(<>{headerEntry(ctx)}</>)
    const entry = container.querySelector('.cxp-entry')
    expect(entry).not.toBeNull()
    const avas = container.querySelectorAll('.cxp-entry .cxp-ava')
    expect(avas).toHaveLength(2)
    expect(avas[0].textContent).toBe('⬢')
  })

  it('无子代理 → headerEntry 返回 null（不渲染入口）', () => {
    const empty = initCodexSubagentState()
    expect(headerEntry({ sliceState: empty, blocks: [] })).toBeNull()
  })
})

describe('codex 形态B — rightViews（cxp-board 每列一子代理）', () => {
  it('有子代理 → 一个视图槽 hasContent，render 出 cxp-board，列数 = 子代理数', () => {
    const s = buildState()
    const ctx: SliceViewCtx = { sliceState: s, blocks: [] }
    const views = rightViews(ctx)
    expect(views).toHaveLength(1)
    expect(views[0].hasContent).toBe(true)
    const { container } = render(<>{views[0].render()}</>)
    expect(container.querySelector('.cxp-board')).not.toBeNull()
    expect(container.querySelectorAll('.cxp-col')).toHaveLength(2)
    // header 含「2 个并行子代理」与「1 运行中」
    expect(container.querySelector('.cxp-pbar')?.textContent).toContain('2')
    expect(container.querySelector('.cxp-pbar')?.textContent).toContain('运行中')
    // 列头任务标签 + 运行中列高亮 is-run
    expect(container.querySelector('.cxp-col-task-label')).not.toBeNull()
    expect(container.querySelector('.cxp-col.is-run')).not.toBeNull()
    // 完成列的汇报
    expect(container.querySelector('.cxp-col .cxp-report')?.textContent).toContain('AAA.txt')
  })

  it('无子代理 → 视图槽 hasContent=false（外壳不显示 tab）', () => {
    const empty = initCodexSubagentState()
    const views = rightViews({ sliceState: empty, blocks: [] })
    expect(views[0].hasContent).toBe(false)
  })
})
