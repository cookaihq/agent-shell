import { test, expect } from 'vitest'
import { z, SharedLifecycleEvent } from '@agent-shell/contracts'
import { getSlice } from '../registry'

// 防卡死安全网：claude 会话的「共享 ∪ 切片」并集必须接受 permission 类事件，否则 canUseTool 永挂。
const claudeAccept = z.union([SharedLifecycleEvent, getSlice('claude').eventSchema!])

test('claude accept: permission_request 必须通过（防卡死核心）', () => {
  expect(claudeAccept.safeParse({ type: 'permission_request', requestId: 'r', toolName: 'Write', input: {} }).success).toBe(true)
})

test('claude accept: ask_user_question / permission_resolved 必须通过', () => {
  expect(claudeAccept.safeParse({ type: 'ask_user_question', requestId: 'q', questions: [] }).success).toBe(true)
  expect(claudeAccept.safeParse({ type: 'permission_resolved', requestId: 'r', outcome: 'allow' }).success).toBe(true)
})

test('claude accept: 共享生命周期事件也通过（turn_start / subagent / message）', () => {
  expect(claudeAccept.safeParse({ type: 'turn_start' }).success).toBe(true)
  expect(claudeAccept.safeParse({ type: 'subagent', phase: 'started', taskId: 't' }).success).toBe(true)
  expect(claudeAccept.safeParse({ type: 'message', text: 'hi' }).success).toBe(true)
})

test('claude accept: 未知/坏帧丢弃（safeParse 失败）', () => {
  expect(claudeAccept.safeParse({ type: 'nonsense' }).success).toBe(false)
  expect(claudeAccept.safeParse({ foo: 1 }).success).toBe(false)
})

test('codex accept（仅共享）：permission 类不通过，但 turn_start / message 通过', () => {
  const codexSchema = getSlice('codex').eventSchema
  expect(codexSchema).toBeUndefined()
  const codexAccept = SharedLifecycleEvent
  expect(codexAccept.safeParse({ type: 'permission_request', requestId: 'r', toolName: 'Write', input: {} }).success).toBe(false)
  expect(codexAccept.safeParse({ type: 'turn_start' }).success).toBe(true)
  expect(codexAccept.safeParse({ type: 'message', text: 'hi' }).success).toBe(true)
})
