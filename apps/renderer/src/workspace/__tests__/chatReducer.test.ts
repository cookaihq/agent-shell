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

  it('optimisticUser 追加 user + running', () => {
    const s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    expect(s.messages.at(-1)).toMatchObject({ role: 'user' })
    expect(s.runStatus).toBe('running')
  })

  it('message/thinking/tool_use 各 push 独立 live 块', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: 'A' } })
    s = chatReducer(s, { type: 'event', ev: { type: 'message', text: 'B' } })
    s = chatReducer(s, { type: 'event', ev: { type: 'tool_use', id: 't1', name: 'Read', input: {} } })
    expect(s.liveBlocks).toEqual([
      { type: 'text', text: 'A' },
      { type: 'text', text: 'B' },
      { type: 'tool_use', id: 't1', name: 'Read', input: {} },
    ])
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

  it('空 live turn_end 不产生空 assistant', () => {
    let s = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    s = chatReducer(s, { type: 'event', ev: { type: 'turn_end', stopReason: 'aborted' } })
    expect(s.messages.filter((m) => m.role === 'assistant')).toHaveLength(0)
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

  it('失败态收到实时内容 → 切回 running 并清 failReason（任务失败灰条不与输出并存）', () => {
    const b = chatReducer(initialChat(), { type: 'optimisticUser', text: 'q' })
    const failed = chatReducer(b, { type: 'event', ev: { type: 'turn_end', stopReason: 'failed', detail: 'boom' } })
    expect(failed.runStatus).toBe('failed')
    // 直接来内容事件（非乐观派发路径，如 ChatHeader 续接 / 重连）也要复活
    const live = chatReducer(failed, { type: 'event', ev: { type: 'message', text: '继续中…' } })
    expect(live.runStatus).toBe('running')
    expect(live.failReason).toBeUndefined()
    expect(live.liveBlocks).toEqual([{ type: 'text', text: '继续中…' }])
  })
})
