import { describe, it, expect } from 'vitest'
import type { TranscriptRecord, AgentEvent } from '@agent-shell/contracts'
import { getSlice } from '../registry'
import { initCodexSubagentState, codexSubagentReduce } from '../codex/subagentView'

// §8 历史重建下沉切片：迁移自 daemon transcriptToMessages 测试。
// claude 切片：含 msg_id/uuid 提取；codex 切片：仅共享骨架（无 msg_id）。
// 共享骨架断言：user_prompt→user msg、assistant_blocks→assistant msg、collapseStreamingText 折叠、
// parentToolUseId / skipTranscript 无损保留（§11#5 形态 A 重载不塌）。

const claude = getSlice('claude').historyService
const codex = getSlice('codex').historyService

describe('claude 切片 historyService.rebuildBlocks', () => {
  it('user_prompt→user DTO；assistant 流→assistant DTO（含 msg_id/uuid）', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: '你好', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'assistant', raw: { type: 'assistant', message: { id: 'msg_9', content: [{ type: 'text', text: '你好呀' }] }, uuid: 'u9' } },
      { ts: 3, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: '你好呀' }] } },
      { ts: 4, engine: 'claude', type: 'result', raw: { type: 'result', is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user', blocks: [{ type: 'text', text: '你好' }] })
    expect(msgs[1]).toMatchObject({ role: 'assistant', sdkMessageId: 'msg_9', sdkUuid: 'u9' })
    expect(msgs[1].blocks[0]).toEqual({ type: 'text', text: '你好呀' })
  })

  it('user_prompt.raw.checkpointId → 挂到 user MessageDTO.checkpointId（逐条 rewind 透传）；无则 undefined', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: 'q1', attachments: [], checkpointId: 'ckpt-1' } },
      { ts: 2, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'a1' }] } },
      { ts: 3, engine: 'claude', type: 'user_prompt', raw: { text: 'q2', attachments: [] } },   // 旧记录无 checkpointId
      { ts: 4, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'a2' }] } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    const users = msgs.filter((m) => m.role === 'user')
    expect(users[0].checkpointId).toBe('ckpt-1')
    expect(users[1].checkpointId).toBeUndefined()   // 历史无 uuid 的旧消息 → 降级（前端禁用该条角标）
  })

  it('跳过 provider 回吐的 typed-prompt user 记录（type==="user"，非 assistant 流 → 不取 msg_id、不产消息）', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: 'q', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'user', raw: { type: 'user', promptSource: 'sdk', message: { role: 'user', content: [{ type: 'text', text: 'q' }] } } },
      { ts: 3, engine: 'claude', type: 'assistant', raw: { type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'a' }] }, uuid: 'u' } },
      { ts: 4, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'a' }] } },
      { ts: 5, engine: 'claude', type: 'result', raw: { type: 'result', is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[1].sdkMessageId).toBe('m')
  })

  it('assistant_blocks 含 thinking 块 → 历史保留思考（历史===实时）', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: 'q', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'assistant', raw: { type: 'assistant', message: { id: 'm', content: [] }, uuid: 'u' } },
      { ts: 3, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'thinking', text: '推理过程', elapsedMs: 1200 }, { type: 'text', text: '答案' }] } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    expect(msgs[1].blocks).toEqual([{ type: 'thinking', text: '推理过程', elapsedMs: 1200 }, { type: 'text', text: '答案' }])
    expect(msgs[1].sdkMessageId).toBe('m')
  })

  it('assistant_blocks 里流式前缀堆叠的文本被折叠（自愈旧脏 transcript）', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: 'q', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [
        { type: 'text', text: 'I will' },
        { type: 'text', text: 'I will start' },
        { type: 'text', text: 'I will start now' },
      ] } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    expect(msgs[1].blocks).toEqual([{ type: 'text', text: 'I will start now' }])
  })

  it('每轮重置 pending msg_id：上一轮的 msg_id 不串到下一轮无 assistant 流的回合', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: 'q1', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'assistant', raw: { type: 'assistant', message: { id: 'm1' }, uuid: 'u1' } },
      { ts: 3, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'a1' }] } },
      { ts: 4, engine: 'claude', type: 'user_prompt', raw: { text: 'q2', attachments: [] } },
      { ts: 5, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'a2' }] } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    const assistants = msgs.filter((m) => m.role === 'assistant')
    expect(assistants[0].sdkMessageId).toBe('m1')
    expect(assistants[1].sdkMessageId).toBeUndefined()
  })
})

describe('codex 切片 historyService.rebuildBlocks', () => {
  it('assistant_blocks → assistant DTO（直接用 blocks，无 msg_id）', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'codex', type: 'user_prompt', raw: { text: 'q', attachments: [] } },
      { ts: 2, engine: 'codex', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'codex 答' }] } },
    ]
    const msgs = codex.rebuildBlocks(recs)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[1].blocks).toEqual([{ type: 'text', text: 'codex 答' }])
    expect(msgs[1].sdkMessageId).toBeUndefined()
    expect(msgs[1].sdkUuid).toBeUndefined()
  })
})

describe('codex 切片 historyService.rebuildSliceState（P5c：子代理状态重载还原）', () => {
  // 一串覆盖各 phase 的 codex_subagent 事件（与 live SSE 同序）。
  const subEvents: Extract<AgentEvent, { type: 'codex_subagent' }>[] = [
    { type: 'codex_subagent', phase: 'spawned', threadId: 'sub-a', parentThreadId: 'main', task: '角色：A\n写文件' },
    { type: 'codex_subagent', phase: 'spawned', threadId: 'sub-b', parentThreadId: 'main', task: '角色：B\n读文件' },
    { type: 'codex_subagent', phase: 'status', threadId: 'sub-a', status: 'running' },
    { type: 'codex_subagent', phase: 'item', threadId: 'sub-a', item: { kind: 'message', text: '部分', streaming: true } },
    { type: 'codex_subagent', phase: 'item', threadId: 'sub-a', item: { kind: 'message', text: '部分内容已写' } },   // 定格替换流式帧
    { type: 'codex_subagent', phase: 'item', threadId: 'sub-b', item: { kind: 'tool_use', id: 't1', name: 'shell', input: { command: 'ls' } } },
    { type: 'codex_subagent', phase: 'wait', threadId: 'main', parentThreadId: 'main', waiting: true },
    { type: 'codex_subagent', phase: 'report', threadId: 'sub-a', report: '完成：AAA.txt' },
    { type: 'codex_subagent', phase: 'status', threadId: 'sub-a', status: 'completed' },
    { type: 'codex_subagent', phase: 'wait', threadId: 'main', parentThreadId: 'main', waiting: false },
    { type: 'codex_subagent', phase: 'closed', threadId: 'sub-b' },
  ]

  // live：外壳把每个 codex_subagent 事件经切片 reduce 累计进 sliceState。
  const liveState = subEvents.reduce<unknown>((acc, ev) => codexSubagentReduce(acc as never, ev as AgentEvent), initCodexSubagentState())

  // 重载：daemon 把每个事件原样存为 `{ type:'codex_subagent', ...ev }` 块，混在 assistant_blocks 里随其它块落库。
  const recs: TranscriptRecord[] = [
    { ts: 1, engine: 'codex', type: 'user_prompt', raw: { text: '派活', attachments: [] } },
    { ts: 2, engine: 'codex', type: 'assistant_blocks', raw: { blocks: [
      // 主线锚点块（renderer timelineMount 挂载点）+ 子代理事件块交错（真实落库顺序）
      { type: 'tool_use', id: 'spawnAgent:main', name: 'spawnAgent', input: { parentThreadId: 'main' } },
      ...subEvents.map((ev) => ({ ...ev })),   // ev 已含 type:'codex_subagent' → 整事件即块（与 daemon 落库一致）
      { type: 'text', text: '主代理总结' },
    ] } },
  ]

  it('round-trip：replay 持久化 codex_subagent 块 === live codexSubagentReduce 累计态', () => {
    const slice = getSlice('codex').historyService
    const rebuilt = slice.rebuildSliceState!(recs)
    expect(rebuilt).toEqual(liveState)
  })

  it('round-trip 守恒：daemon 落库丢弃流式 message 帧后，replay 仍 === 含流式帧的 live 态', () => {
    // 模拟新 daemon 行为：onEvent 不落「流式 message 帧」（item.streaming:true），只留定格帧（streaming 缺省）+ 全部非 message 帧。
    // 而 liveState 是「含流式帧」全序 reduce 的结果——若两者相等，证明丢流式帧不改最终折叠态（reduce 替换语义使流式末帧
    // 与定格帧落到同一块，定格帧 text=全文=流式会折成的那条）。这正是 daemon 侧 round-trip 守恒的渲染端验证。
    const persistedAfterDrop = subEvents.filter(
      (ev) => !(ev.phase === 'item' && ev.item?.kind === 'message' && ev.item.streaming === true),
    )
    const recsDropped: TranscriptRecord[] = [
      { ts: 1, engine: 'codex', type: 'user_prompt', raw: { text: '派活', attachments: [] } },
      { ts: 2, engine: 'codex', type: 'assistant_blocks', raw: { blocks: [
        { type: 'tool_use', id: 'spawnAgent:main', name: 'spawnAgent', input: { parentThreadId: 'main' } },
        ...persistedAfterDrop.map((ev) => ({ ...ev })),
        { type: 'text', text: '主代理总结' },
      ] } },
    ]
    const slice = getSlice('codex').historyService
    const rebuilt = slice.rebuildSliceState!(recsDropped)
    expect(rebuilt).toEqual(liveState)
  })

  it('rebuildBlocks 仍只产共享骨架消息（codex_subagent 块不渲染成中立消息，锚点 tool_use 保留）', () => {
    const slice = getSlice('codex').historyService
    const msgs = slice.rebuildBlocks(recs)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    const assistant = msgs[1]
    // 锚点 spawnAgent + 主线文本保留；codex_subagent 块作为不透明块随行（不影响共享渲染，timelineMount 读 sliceState）
    expect(assistant.blocks.some((b) => b.type === 'tool_use' && (b as { name?: string }).name === 'spawnAgent')).toBe(true)
    expect(assistant.blocks.some((b) => b.type === 'text' && (b as { text?: string }).text === '主代理总结')).toBe(true)
  })

  it('claude 切片无 rebuildSliceState（外壳回落 initSliceState）', () => {
    expect(getSlice('claude').historyService.rebuildSliceState).toBeUndefined()
  })
})

describe('旧格式兼容（§11#5：形态 A 多层嵌套重载不塌）', () => {
  it('旧 assistant_blocks 的子代理嵌套块：parentToolUseId + skipTranscript 无损保留', () => {
    // 模拟重构前 jsonl：一轮里含 Task tool_use（skipTranscript:true）+ 子代理内部块（parentToolUseId 指向 Task id）
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: '跑子代理', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'assistant', raw: { type: 'assistant', message: { id: 'mT' }, uuid: 'uT' } },
      { ts: 3, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [
        { type: 'tool_use', id: 'task-1', name: 'Task', input: { description: '子任务' }, skipTranscript: true },
        { type: 'text', text: '子代理在读文件', parentToolUseId: 'task-1' },
        { type: 'tool_use', id: 'inner-read', name: 'Read', input: { file_path: '/a.ts' }, parentToolUseId: 'task-1' },
        { type: 'tool_result', toolUseId: 'inner-read', ok: true, content: '...', parentToolUseId: 'task-1' },
        { type: 'text', text: '主线总结' },
      ] } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    const assistant = msgs.find((m) => m.role === 'assistant')!
    // 块数不变（折叠对非前缀块 no-op）
    expect(assistant.blocks).toHaveLength(5)
    // skipTranscript 保留在 Task 块上（§9.5 重载后形态 A 据此从时间线排除）
    expect(assistant.blocks[0]).toMatchObject({ type: 'tool_use', name: 'Task', skipTranscript: true })
    // parentToolUseId 保留在每个子代理内部块上（buildChildrenMap 嵌套依赖）
    expect((assistant.blocks[1] as { parentToolUseId?: string }).parentToolUseId).toBe('task-1')
    expect((assistant.blocks[2] as { parentToolUseId?: string }).parentToolUseId).toBe('task-1')
    expect((assistant.blocks[3] as { parentToolUseId?: string }).parentToolUseId).toBe('task-1')
    // 主线块无 parentToolUseId（不误塞）
    expect((assistant.blocks[4] as { parentToolUseId?: string }).parentToolUseId).toBeUndefined()
  })
})
