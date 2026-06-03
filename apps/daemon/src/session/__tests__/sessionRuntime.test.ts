import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'node:events'
import { openDatabase } from '../../db/database'
import { createProject } from '../../db/projects'
import { createSession, getSession } from '../../db/sessions'
import { getMessages } from '../../db/messages'
import { getUsage } from '../../db/usage'
import { SessionRuntime } from '../sessionRuntime'
import type { AgentEvent } from '@agent-shell/contracts'

function fakeChild() {
  const cp: any = new EventEmitter()
  cp.stdout = new EventEmitter(); cp.stderr = new EventEmitter()
  cp.stdinWrites = []; cp.stdinEnded = false; cp.killed = false; cp.killSignals = []
  cp.stdin = { write: (s: string) => { cp.stdinWrites.push(s); return true }, end: () => { cp.stdinEnded = true } }
  cp.kill = (sig?: string) => { cp.killed = true; cp.killSignals.push(sig || 'SIGTERM'); return true }
  return cp
}

function setup(engine: 'claude' | 'codex' = 'codex') {
  const db = openDatabase(':memory:')
  const proj = createProject(db, { name: 'p', path: '/work' })
  const sess = createSession(db, { projectId: proj.id, engine, model: engine === 'claude' ? 'opus' : 'gpt-5' })
  const children: any[] = []
  const spawnFn = (() => { const cp = fakeChild(); children.push(cp); return cp }) as any
  const rt = new SessionRuntime({ db, resolveBin: () => '/abs/bin', spawnFn })
  return { db, proj, sess, rt, children }
}

describe('SessionRuntime 单轮闭环', () => {
  it('codex submit：起进程→事件 fan-out→turn_end 落库（assistant message + usage + status completed + turn=1）', async () => {
    const { db, sess, rt, children } = setup('codex')
    const seen: AgentEvent[] = []
    rt.subscribe(sess.id, (e) => seen.push(e))
    rt.submit(sess.id, '你好')

    const cp = children[0]
    // codex 一轮：thread.started(带 id) → agent_message → turn.completed
    cp.stdout.emit('data', JSON.stringify({ type: 'thread.started', thread_id: 'th-1' }) + '\n')
    cp.stdout.emit('data', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '回答' } }) + '\n')
    cp.stdout.emit('data', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 5, output_tokens: 7 } }) + '\n')
    cp.emit('close', 0, null)
    await new Promise((r) => setImmediate(r))   // 等 done 微任务跑完

    // 订阅者收到 message/usage/turn_end
    expect(seen.map((e) => e.type)).toEqual(['message', 'usage', 'turn_end'])
    // 落库：user 一条 + assistant 一条
    const msgs = getMessages(db, sess.id)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[0].blocks).toEqual([{ type: 'text', text: '你好' }])
    expect(msgs[1].blocks).toContainEqual({ type: 'text', text: '回答' })
    // usage turn=1
    expect(getUsage(db, sess.id)).toMatchObject([{ turn: 1, inputTokens: 5, outputTokens: 7 }])
    // status completed + resumable_id 落库
    expect(getSession(db, sess.id)).toMatchObject({ status: 'completed', resumableId: 'th-1' })
    expect(rt.isRunning(sess.id)).toBe(false)
  })

  it('codex submit：user 消息在 submit 时立即落库（刷新可见）', () => {
    const { db, sess, rt } = setup('codex')
    rt.submit(sess.id, '先记一笔')
    expect(getMessages(db, sess.id).map((m) => m.role)).toEqual(['user'])
  })

  it('失败 turn（turn.failed）→ status failed，不 recordUsage', async () => {
    const { db, sess, rt, children } = setup('codex')
    rt.submit(sess.id, 'x')
    const cp = children[0]
    cp.stdout.emit('data', JSON.stringify({ type: 'turn.failed', error: { message: 'upstream 503' } }) + '\n')
    cp.emit('close', 1, null)
    await new Promise((r) => setImmediate(r))
    expect(getSession(db, sess.id)).toMatchObject({ status: 'failed' })
    expect(getUsage(db, sess.id)).toEqual([])
  })
})

describe('SessionRuntime 续投队列', () => {
  it('claude：单轮完成后 endInput 收尾，running 归 false', async () => {
    const { sess, rt, children } = setup('claude')
    rt.submit(sess.id, 'q1')
    const cp = children[0]
    cp.stdout.emit('data', JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1' }) + '\n')
    cp.stdout.emit('data', JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'a1' }] }, session_id: 's-1' }) + '\n')
    cp.stdout.emit('data', JSON.stringify({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, session_id: 's-1' }) + '\n')
    // onTurnEnd 后队列空 → endInput 关 stdin
    expect(cp.stdinEnded).toBe(true)
    cp.emit('close', 0, null)
    await new Promise((r) => setImmediate(r))
    expect(rt.isRunning(sess.id)).toBe(false)
  })

  it('claude 运行中续投：turn 进行时 submit→入队；turn_end 后写同进程 stdin、不新起进程', async () => {
    const { sess, rt, children } = setup('claude')
    rt.submit(sess.id, 'q1')
    const cp = children[0]
    rt.submit(sess.id, 'q2')                         // 运行中 → 入队
    expect(children.length).toBe(1)                  // 没起新进程
    cp.stdout.emit('data', JSON.stringify({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, session_id: 's-1' }) + '\n')
    // 队列有 q2 → pushUser 同进程，不 endInput
    expect(cp.stdinEnded).toBe(false)
    expect(children.length).toBe(1)
    const lastWrite = JSON.parse(cp.stdinWrites.at(-1)!.trim())
    expect(lastWrite).toMatchObject({ type: 'user', message: { content: [{ type: 'text', text: 'q2' }] } })
  })

  it('claude 排空窗口：endInput 后、close 前 submit 的消息，close 后用 resume 起新进程投递（不丢）', async () => {
    const { sess, rt, children } = setup('claude')
    rt.submit(sess.id, 'q1')
    const cp = children[0]
    cp.stdout.emit('data', JSON.stringify({ type: 'system', subtype: 'init', session_id: 's-1' }) + '\n')
    cp.stdout.emit('data', JSON.stringify({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 }, session_id: 's-1' }) + '\n')
    expect(cp.stdinEnded).toBe(true)   // endInput 已调，但进程未 close、running 仍 true
    rt.submit(sess.id, 'q2')           // 排空窗口：入队（running true，不新起进程）
    expect(children.length).toBe(1)
    cp.emit('close', 0, null)          // 首轮进程退出 → onDone 应续投 q2
    await new Promise((r) => setImmediate(r))
    expect(children.length).toBe(2)    // 起了新进程投递 q2
    expect(rt.isRunning(sess.id)).toBe(true)
  })

  it('codex 续投：turn 完成进程退出后，队列有则起新进程', async () => {
    const { sess, rt, children } = setup('codex')
    rt.submit(sess.id, 'q1')
    const cp1 = children[0]
    rt.submit(sess.id, 'q2')                         // 入队
    cp1.stdout.emit('data', JSON.stringify({ type: 'thread.started', thread_id: 'th-9' }) + '\n')
    cp1.stdout.emit('data', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n')
    cp1.emit('close', 0, null)
    await new Promise((r) => setImmediate(r))
    // 起了第二个进程
    expect(children.length).toBe(2)
    expect(rt.isRunning(sess.id)).toBe(true)
  })

  // 加固：claude 进程崩溃（合成 turn_end failed）也会触发 onTurnEnd——此时进程已死，绝不能 pushUser 到死进程
  it('claude 崩溃（合成 turn_end failed）+ 队列有消息 → 不 pushUser 到死进程、清队列、running false', async () => {
    const { sess, rt, children } = setup('claude')
    rt.submit(sess.id, 'q1')
    const cp = children[0]
    rt.submit(sess.id, 'q2')             // 入队
    const writesBefore = cp.stdinWrites.length
    cp.emit('close', 1, null)            // 无 turn_end → 合成 turn_end(failed)
    await new Promise((r) => setImmediate(r))
    expect(cp.stdinWrites.length).toBe(writesBefore)   // 没有对死进程 pushUser
    expect(children.length).toBe(1)                    // 没起新进程
    expect(rt.isRunning(sess.id)).toBe(false)
  })
})

describe('SessionRuntime interrupt', () => {
  it('interrupt：对活进程发 SIGTERM、清空队列、合成 turn_end(aborted) 落 status=aborted', async () => {
    const { db, sess, rt, children } = setup('codex')
    rt.submit(sess.id, 'q1')
    rt.submit(sess.id, 'q2')           // 入队
    const cp = children[0]
    rt.interrupt(sess.id)
    expect(cp.killSignals).toContain('SIGTERM')
    cp.emit('close', null, 'SIGTERM')  // 进程被中断退出，无 turn_end → 合成 aborted
    await new Promise((r) => setImmediate(r))
    expect(getSession(db, sess.id)).toMatchObject({ status: 'aborted' })
    // 队列已清空：不会起第二个进程
    expect(children.length).toBe(1)
    expect(rt.isRunning(sess.id)).toBe(false)
  })

  it('interrupt 空闲会话：no-op（无活进程不抛）', () => {
    const { sess, rt } = setup('codex')
    expect(() => rt.interrupt(sess.id)).not.toThrow()
  })
})
