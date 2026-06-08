import { describe, it, expect } from 'vitest'
import { chatReducer, initialChat } from '../chatReducer'
import type { MessageDTO } from '../../api/types'

const msg = (role: 'user' | 'assistant', text: string): MessageDTO => ({ id: role + text, sessionId: 's', role, blocks: [{ type: 'text', text }], createdAt: 0 })

describe('chatReducer', () => {
  it('loadHistory 设历史清 live', () => {
    const s = chatReducer(initialChat(), { type: 'loadHistory', messages: [msg('user', 'hi')], running: false })
    expect(s.messages).toHaveLength(1)
    expect(s.liveBlocks).toBeNull()
    expect(s.runStatus).toBe('idle')
  })

  it('loadHistory 经 slice.rebuildSliceState(records) 还原 sliceState（P5c：codex 子代理重载还原）', () => {
    // 切片提供 rebuildSliceState：从 records 重建私有态（这里用桩模拟 codex replay 结果）。
    const slice = {
      initSliceState: () => ({ subs: {}, waiting: {} }),
      rebuildSliceState: (records: { type: string }[]) =>
        records.some((r) => r.type === 'assistant_blocks') ? { subs: { 'sub-a': { threadId: 'sub-a' } }, waiting: {} } : { subs: {}, waiting: {} },
    }
    const records = [{ ts: 1, engine: 'codex', type: 'assistant_blocks', raw: {} }]
    const s = chatReducer(initialChat(), { type: 'loadHistory', messages: [msg('user', 'hi')], running: false, slice, records: records as any })
    // sliceState 用 rebuildSliceState 的产物种子（非空 initSliceState）
    expect(s.sliceState).toEqual({ subs: { 'sub-a': { threadId: 'sub-a' } }, waiting: {} })
  })

  it('loadHistory 无 rebuildSliceState（如 claude）→ 回落 initSliceState', () => {
    const slice = { initSliceState: () => ({ marker: 'init' }) }
    const s = chatReducer(initialChat(), { type: 'loadHistory', messages: [], running: false, slice, records: [] as any })
    expect(s.sliceState).toEqual({ marker: 'init' })
  })

  it('optimisticUser 追加 user + running', () => {
    const s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    expect(s.messages.at(-1)).toMatchObject({ role: 'user' })
    expect(s.runStatus).toBe('running')
  })

  it('optimisticUser 带附件 → user 消息含 attachments 块（即时 📎 回显）', () => {
    const s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q', attachments: [{ name: 'a.png', path: 'attachments/a.png' }] })
    expect(s.messages.at(-1)!.blocks).toEqual([
      { type: 'text', text: 'q' },
      { type: 'attachments', files: [{ name: 'a.png', path: 'attachments/a.png' }] },
    ])
  })

  it('optimisticUser 无附件 → 仅 text 块（回归）', () => {
    const s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    expect(s.messages.at(-1)!.blocks).toEqual([{ type: 'text', text: 'q' }])
  })

  it('message/thinking/tool_use 各 push 独立 live 块', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: 'A' } })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: 'B' } })
    s = chatReducer(s, { type: 'event', ev: { type: 'tool_use', id: 't1', name: 'Read', input: {} } })
    expect(s.liveBlocks).toMatchObject([
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
      { type: 'tool_use', id: 't1', name: 'Read', input: {} },   // 另带 startedAt 时间戳（计时用）
    ])
    expect((s.liveBlocks![2] as { startedAt?: number }).startedAt).toBeTypeOf('number')
  })

  it('turn_end end_turn → live 并入 assistant + completed', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: 'ok' } })
    s = chatReducer(s, { type: 'event', ev: { type: 'turn_end', stopReason: 'end_turn' } })
    expect(s.liveBlocks).toBeNull()
    expect(s.runStatus).toBe('completed')
    expect(s.messages.at(-1)).toMatchObject({ role: 'assistant', blocks: [{ type: 'text', text: 'ok' }] })
  })

  it('turn_end failed/aborted 映射', () => {
    const b = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    expect(chatReducer(b, { type: 'event', ev: { type: 'turn_end', stopReason: 'failed' } }).runStatus).toBe('failed')
    expect(chatReducer(b, { type: 'event', ev: { type: 'turn_end', stopReason: 'aborted' } }).runStatus).toBe('aborted')
  })

  it('空 live 成功 turn_end 不产生空 assistant', () => {
    // 成功且无产出的轮（如纯热切换/空响应）不该留空气泡
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'turn_end', stopReason: 'end_turn' } })
    expect(s.messages.filter((m) => m.role === 'assistant')).toHaveLength(0)
  })

  it('空 live 失败 turn_end 产生仅含 run_note 的留痕消息（含真因）', () => {
    // 失败是历史事实（带真因），即使本轮无正文也留一条内联 run_note 块 → 重载留痕 + 末轮继续入口
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'turn_end', stopReason: 'failed', detail: 'credit too low' } })
    const a = s.messages.filter((m) => m.role === 'assistant')
    expect(a).toHaveLength(1)
    expect(a[0].blocks).toEqual([{ type: 'run_note', stopReason: 'failed', detail: 'credit too low' }])
  })

  it('非空 live 失败 turn_end → run_note 块接在正文之后', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: '半截' } })
    s = chatReducer(s, { type: 'event', ev: { type: 'turn_end', stopReason: 'failed', detail: 'boom' } })
    expect(s.messages.at(-1)!.blocks).toEqual([
      { type: 'text', text: '半截' },
      { type: 'run_note', stopReason: 'failed', detail: 'boom' },
    ])
  })

  it('loadHistory 按 status 还原失败/中止 runStatus（缺口A：重载也能挂继续按钮）', () => {
    const failed = chatReducer(initialChat(), { type: 'loadHistory', messages: [], running: false, status: 'failed' })
    expect(failed.runStatus).toBe('failed')
    const aborted = chatReducer(initialChat(), { type: 'loadHistory', messages: [], running: false, status: 'aborted' })
    expect(aborted.runStatus).toBe('aborted')
    // 运行中优先于落库状态
    const run = chatReducer(initialChat(), { type: 'loadHistory', messages: [], running: true, status: 'failed' })
    expect(run.runStatus).toBe('running')
  })

  it('usage 累积 liveUsage', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'usage', inputTokens: 10, outputTokens: 5, costUsd: 0.1 } })
    expect(s.liveUsage).toMatchObject({ inputTokens: 10, outputTokens: 5 })
  })

  it('turn_end.detail → failReason；成功 turn_end 清空 failReason', () => {
    const b = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    const failed = chatReducer(b, { type: 'event', ev: { type: 'turn_end', stopReason: 'failed', detail: 'exit 1 · boom' } })
    expect(failed.runStatus).toBe('failed')
    expect(failed.failReason).toBe('exit 1 · boom')
    // 失败后再发起一轮成功 → failReason 自动清空
    const rerun = chatReducer(failed, { type: 'optimisticUser', text: '继续' })
    const ok = chatReducer(rerun, { type: 'event', ev: { type: 'turn_end', stopReason: 'end_turn' } })
    expect(ok.failReason).toBeUndefined()
  })

  it('失败态 → turn_start 复活 running 清 failReason，再来内容追加（失败灰条不与输出并存）', () => {
    const b = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    const failed = chatReducer(b, { type: 'event', ev: { type: 'turn_end', stopReason: 'failed', detail: 'boom' } })
    expect(failed.runStatus).toBe('failed')
    // 续接 / 重连：daemon 在新一轮开始发 turn_start（非「识别内容事件反推」）→ 复活并清失败提示
    const started = chatReducer(failed, { type: 'event', ev: { type: 'turn_start' } })
    expect(started.runStatus).toBe('running')
    expect(started.failReason).toBeUndefined()
    expect(started.liveBlocks).toEqual([])
    // 随后内容追加进新一轮 live 缓冲
    const live = chatReducer(started, { type: 'event', ev: { type: 'message', text: '继续中…' } })
    expect(live.runStatus).toBe('running')
    expect(live.liveBlocks).toEqual([{ type: 'text', text: '继续中…' }])
  })

  it('turn_start 单独：失败/完成/idle 态 → running + 清 failReason + 起新 live 缓冲（liveBlocks 为 null 时置 []）', () => {
    // failed → turn_start
    const b = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    const failed = chatReducer(b, { type: 'event', ev: { type: 'turn_end', stopReason: 'failed', detail: 'boom' } })
    expect(failed.liveBlocks).toBeNull()
    const s1 = chatReducer(failed, { type: 'event', ev: { type: 'turn_start' } })
    expect(s1.runStatus).toBe('running')
    expect(s1.failReason).toBeUndefined()
    expect(s1.liveBlocks).toEqual([])
    // idle 初始态 → turn_start（重连/续接，无 optimisticUser）
    const s2 = chatReducer(initialChat(), { type: 'event', ev: { type: 'turn_start' } })
    expect(s2.runStatus).toBe('running')
    expect(s2.liveBlocks).toEqual([])
  })

  it('turn_start 幂等：已 running 且 live 已有内容 → 不清空 liveBlocks / messages', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })  // running, live=[]
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: 'A' } })
    const before = s.liveBlocks
    s = chatReducer(s, { type: 'event', ev: { type: 'turn_start' } })
    expect(s.runStatus).toBe('running')
    expect(s.liveBlocks).toEqual(before)   // 保留已有 live 缓冲（?? 不覆盖）
    expect(s.messages.filter((m) => m.role === 'user')).toHaveLength(1)
  })

  it('context_compacted：仅消费、不改 runStatus / messages（divider 渲染本期 DEFERRED）', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: 'A' } })
    const before = s
    s = chatReducer(s, { type: 'event', ev: { type: 'context_compacted' } })
    expect(s.runStatus).toBe(before.runStatus)
    expect(s.messages).toEqual(before.messages)
    expect(s.liveBlocks).toEqual(before.liveBlocks)
  })

  it('progress → 存 liveProgress，不建块', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'progress', tokens: 42, activity: { kind: 'thinking' } } })
    expect(s.liveProgress).toEqual({ tokens: 42, activity: { kind: 'thinking' } })
    expect(s.liveBlocks).toEqual([])   // 进度是瞬时状态行，不该建块
  })

  it('turn_end 清空 liveProgress（状态行消失，任何 stopReason 都清）', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'progress', tokens: 99, activity: { kind: 'tool', tool: 'Read', target: 'a.ts' } } })
    expect(s.liveProgress).toBeDefined()
    s = chatReducer(s, { type: 'event', ev: { type: 'turn_end', stopReason: 'aborted' } })
    expect(s.liveProgress).toBeUndefined()
  })

  it('permission_request → 入 pendingRequests（授权卡）；permission_resolved → 移除', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'permission_request', requestId: 'r1', toolName: 'Write', input: { file_path: 'a.ts' }, title: 'Claude wants to write a.ts' } })
    expect(s.pendingRequests).toHaveLength(1)
    expect(s.pendingRequests[0]).toMatchObject({ kind: 'permission', requestId: 'r1', toolName: 'Write' })
    s = chatReducer(s, { type: 'event', ev: { type: 'permission_resolved', requestId: 'r1', outcome: 'allow' } })
    expect(s.pendingRequests).toHaveLength(0)
  })

  it('ask_user_question → 入 pendingRequests（选择卡）', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'ask_user_question', requestId: 'q1', questions: [{ question: '选?', options: [{ label: 'A' }] }] } })
    expect(s.pendingRequests[0]).toMatchObject({ kind: 'question', requestId: 'q1' })
  })

  it('逐字流式：message(streaming) 原地替换末尾文本块；streaming:false 定格；后续工具块另起', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: '你', streaming: true } })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: '你好', streaming: true } })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: '你好世界', streaming: true } })
    // 三帧流式 → 仍只有一个文本块，内容为最新累计
    expect(s.liveBlocks).toEqual([{ type: 'text', text: '你好世界' }])
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: '你好世界', streaming: false } })
    expect(s.liveBlocks).toEqual([{ type: 'text', text: '你好世界' }])
    // 工具块 → 复位流式态；之后再流式 → 新文本块
    s = chatReducer(s, { type: 'event', ev: { type: 'tool_use', id: 't1', name: 'Read', input: {} } })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: '继续', streaming: true } })
    expect(s.liveBlocks).toMatchObject([{ type: 'text', text: '你好世界' }, { type: 'tool_use' }, { type: 'text', text: '继续' }])
  })

  it('非流式 message（无 streaming 标记）逐条追加（codex / 兼容）', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: 'A' } })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: 'B' } })
    expect(s.liveBlocks).toEqual([{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }])
  })

  it('turn_end 兜底清空挂起请求（防悬挂）', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'permission_request', requestId: 'r1', toolName: 'Bash', input: {} } })
    expect(s.pendingRequests).toHaveLength(1)
    s = chatReducer(s, { type: 'event', ev: { type: 'turn_end', stopReason: 'aborted' } })
    expect(s.pendingRequests).toHaveLength(0)
  })

  it('回答 AskUserQuestion（permission_resolved，无其它挂起）→ 状态行「正在调用」转「处理中…」（activity 置空）', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    // agent 调 AskUserQuestion：progress(tool) + 选择卡挂起
    s = chatReducer(s, { type: 'event', ev: { type: 'progress', tokens: 1400, activity: { kind: 'tool', tool: 'AskUserQuestion' } } })
    s = chatReducer(s, { type: 'event', ev: { type: 'ask_user_question', requestId: 'q1', questions: [{ question: '选?', options: [{ label: 'A' }] }] } })
    expect(s.liveProgress?.activity).toEqual({ kind: 'tool', tool: 'AskUserQuestion' })
    // 回答 → daemon 发 permission_resolved → 卡片移除 + activity 置空（WorkStatus 显示「处理中…」）
    s = chatReducer(s, { type: 'event', ev: { type: 'permission_resolved', requestId: 'q1', outcome: 'allow' } })
    expect(s.pendingRequests).toHaveLength(0)
    expect(s.liveProgress?.activity).toBeUndefined()
    expect(s.liveProgress?.tokens).toBe(1400)   // token 计数保留
  })

  it('permission_resolved 但仍有其它挂起 → 不重置 activity（避免误转）', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'progress', tokens: 100, activity: { kind: 'tool', tool: 'AskUserQuestion' } } })
    s = chatReducer(s, { type: 'event', ev: { type: 'permission_request', requestId: 'p1', toolName: 'Bash', input: {} } })
    s = chatReducer(s, { type: 'event', ev: { type: 'permission_request', requestId: 'p2', toolName: 'Write', input: {} } })
    s = chatReducer(s, { type: 'event', ev: { type: 'permission_resolved', requestId: 'p1', outcome: 'allow' } })
    expect(s.pendingRequests).toHaveLength(1)
    expect(s.liveProgress?.activity).toEqual({ kind: 'tool', tool: 'AskUserQuestion' })   // 还有挂起 → 不重置
  })

  it('thinking 态时 permission_resolved → 不误转处理中（仅 tool 态才转）', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'progress', tokens: 50, activity: { kind: 'thinking' } } })
    s = chatReducer(s, { type: 'event', ev: { type: 'permission_resolved', requestId: 'x', outcome: 'allow' } })
    expect(s.liveProgress?.activity).toEqual({ kind: 'thinking' })   // thinking 不动
  })

  // 子代理（subagent）生命周期累计已平移到 claude 切片私有 reducer（spec §6 Phase 2）：
  // 见 agents/claude/__tests__/subagent.test.tsx（subagentReduce 直测）。
  // 此处仅守护「外壳委托：subagent 事件经 action.slice.reduce 累计进 sliceState、不触 messages」。
  it('外壳委托：subagent 事件经 slice.reduce 累计进 sliceState（外壳不解释其结构）', () => {
    const slice = {
      initSliceState: () => ({}),
      reduce: (st: unknown, ev: { type: string; taskId?: string }) =>
        ev.type === 'subagent' ? { ...(st as Record<string, unknown>), [ev.taskId!]: ev } : st,
    }
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'subagent', phase: 'started', taskId: 'tk1', toolUseId: 'tu1', subagentType: 'g', description: 'x' }, slice })
    // 委托累计进 sliceState；messages 不受影响
    expect((s.sliceState as Record<string, unknown>)['tk1']).toBeDefined()
    expect(s.messages.filter((m) => m.role === 'assistant')).toHaveLength(0)
  })
})

it('turn_end 把 sdkMessageId 落到新生成的 assistant 消息', () => {
  let st = initialChat()
  st = chatReducer(st, { type: 'event', ev: { type: 'message', text: 'hi' } as any })
  st = chatReducer(st, { type: 'event', ev: { type: 'turn_end', stopReason: 'end_turn', sdkMessageId: 'msg_77', sdkUuid: 'u77' } as any })
  const last = st.messages.at(-1)!
  expect(last.role).toBe('assistant')
  expect((last as any).sdkMessageId).toBe('msg_77')
})
