import { describe, it, expect, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { openDatabase } from '../../db/database'
import { createProject } from '../../db/projects'
import { createSession, getSession } from '../../db/sessions'
import { getMessages } from '../../db/messages'
import { getUsage } from '../../db/usage'
import { readRecords } from '../transcript'
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

const flush = async (n = 4) => { for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r)) }

/** 假 SDK query：每次调用一个实例（记录 options + 后台消费输入流收到的 user 文本）；测试用 current() 拿最近实例、emit 灌响应、close 收尾。
 *  完成时机绑定输入流：runtime endInput → 输入流结束且无待发 → generator 完成（模拟 SDK「输入尽 + turn 毕 → 退出」）。 */
function fakeClaudeQuery() {
  const instances: any[] = []
  const queryFn = (args: any) => {
    const inst: any = { options: args.options, received: [] as string[], emitQ: [] as any[], waiting: null as any, inputEnded: false, genDone: false, interrupts: 0, setPermissionMode: [] as string[], applyFlagSettings: [] as any[], setModel: [] as string[] }
    instances.push(inst)
    const maybeComplete = () => { if (inst.inputEnded && inst.emitQ.length === 0 && inst.waiting) { const w = inst.waiting; inst.waiting = null; inst.genDone = true; w({ done: true, value: undefined }) } }
    inst.maybeComplete = maybeComplete
    ;(async () => { for await (const m of args.prompt) { const t = m?.message?.content?.[0]?.text; if (typeof t === 'string') inst.received.push(t) } inst.inputEnded = true; maybeComplete() })()
    const iterator = {
      next: () => {
        if (inst.emitQ.length) return Promise.resolve({ done: false, value: inst.emitQ.shift() })
        if (inst.genDone) return Promise.resolve({ done: true, value: undefined })
        return new Promise((res) => { inst.waiting = res; if (inst.inputEnded) maybeComplete() })
      },
      [Symbol.asyncIterator]() { return iterator },
    }
    inst.q = {
      ...iterator,
      interrupt: async () => { inst.interrupts++; inst.inputEnded = true; inst.genDone = true; if (inst.waiting) { const w = inst.waiting; inst.waiting = null; w({ done: true, value: undefined }) } },
      setPermissionMode: async (m: string) => { inst.setPermissionMode.push(m) },
      setModel: async (m: string) => { inst.setModel.push(m) }, applyFlagSettings: async (s: any) => { inst.applyFlagSettings.push(s) },
      supportedModels: async () => [], rewindFiles: async () => ({ canRewind: true }),
    }
    return inst.q
  }
  const emit = (msg: any) => { const inst = instances.at(-1); if (inst.waiting) { const w = inst.waiting; inst.waiting = null; w({ done: false, value: msg }) } else inst.emitQ.push(msg) }
  return { queryFn, instances, current: () => instances.at(-1), emit }
}

function setup(engine: 'claude' | 'codex' = 'codex', opts: { transcriptDir?: string } = {}) {
  const db = openDatabase(':memory:')
  const proj = createProject(db, { name: 'p', path: '/work' })
  const sess = createSession(db, { projectId: proj.id, engine, model: engine === 'claude' ? 'opus' : 'gpt-5' })
  const children: any[] = []
  const spawnFn = (() => { const cp = fakeChild(); children.push(cp); return cp }) as any
  const claude = fakeClaudeQuery()
  const rt = new SessionRuntime({ db, resolveBin: () => '/abs/bin', spawnFn, claudeQueryFn: claude.queryFn as any, transcriptDir: opts.transcriptDir })
  return { db, proj, sess, rt, children, claude }
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
    // messages 表不再写入 user/assistant（已改写 transcript）
    const msgs = getMessages(db, sess.id)
    expect(msgs).toHaveLength(0)
    // usage turn=1
    expect(getUsage(db, sess.id)).toMatchObject([{ turn: 1, inputTokens: 5, outputTokens: 7 }])
    // status completed + resumable_id 落库
    expect(getSession(db, sess.id)).toMatchObject({ status: 'completed', resumableId: 'th-1' })
    expect(rt.isRunning(sess.id)).toBe(false)
  })

  it('codex submit：user 消息在 submit 时立即写入 transcript（不再写 messages 表）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { db, sess, rt } = setup('codex', { transcriptDir: dir })
      rt.submit(sess.id, '先记一笔')
      // transcript 立即有 user_prompt 记录
      expect(readRecords(dir, sess.id)[0]).toMatchObject({ type: 'user_prompt', raw: { text: '先记一笔' } })
      // messages 表无写入
      expect(getMessages(db, sess.id)).toHaveLength(0)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
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
  it('claude：单轮完成后 endInput 收尾，query 结束、running 归 false', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.subscribe(sess.id, () => {})
    rt.submit(sess.id, 'q1')
    await flush()
    claude.emit({ type: 'system', subtype: 'init', session_id: 's-1' })
    claude.emit({ type: 'assistant', message: { content: [{ type: 'text', text: 'a1' }] } })
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()
    // 队列空 → endInput → 输入流尽 → query 完成 → running false
    expect(claude.instances.length).toBe(1)
    expect(rt.isRunning(sess.id)).toBe(false)
  })

  it('claude 运行中续投：turn 进行时 submit→入队；turn_end 后 pushUser 同一 query、不新起 query', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, 'q1')
    await flush()
    rt.submit(sess.id, 'q2')                         // 运行中 → 入队
    expect(claude.instances.length).toBe(1)          // 没起新 query
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()
    // 队列有 q2 → pushUser 同一 query（不新起），query 收到了 q1+q2
    expect(claude.instances.length).toBe(1)
    expect(claude.current().received).toEqual(['q1', 'q2'])
    expect(rt.isRunning(sess.id)).toBe(true)
  })

  it('claude 持久 query：q1 完成后保活（running false 但 query 不退出）→ 空闲 submit q2 复用同 query（不重 spawn / 不 resume）', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, 'q1')
    await flush()
    claude.emit({ type: 'system', subtype: 'init', session_id: 's-1' })
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()                      // q1 完成 → 不 endInput，query 保活，running 归 false
    expect(rt.isRunning(sess.id)).toBe(false)
    expect(claude.instances.length).toBe(1)            // query 仍是同一个（未退出）
    rt.submit(sess.id, 'q2')           // 空闲态续投 → 复用同 query pushUser
    await flush()
    expect(claude.instances.length).toBe(1)            // 没起新 query
    expect(claude.current().received).toEqual(['q1', 'q2'])
    expect(rt.isRunning(sess.id)).toBe(true)
  })

  it('claude 持久 query：回合后 query 仍存活 → rewindFiles / decision 在回合后可用（#7 修复）', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, 'q1')
    await flush()
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()
    expect(rt.isRunning(sess.id)).toBe(false)
    // 回合结束、query 仍存活 → rewindFiles 委托到活 query（用宿主分配的检查点 uuid），不再「会话已结束」
    const rw = await rt.rewindFiles(sess.id, undefined)
    expect(rw).toMatchObject({ canRewind: true })
    expect(() => rt.resolveDecision(sess.id, 'x', { behavior: 'allow' })).not.toThrow()
  })

  it('claude 持久 query：空闲超时 → endInput 关闭 query（避免空闲进程长留）', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/work' })
    const sess = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    const claude = fakeClaudeQuery()
    const rt = new SessionRuntime({ db, resolveBin: () => '/abs/bin', claudeQueryFn: claude.queryFn as any, claudeSessionIdleMs: 30 })
    rt.subscribe(sess.id, () => {})
    rt.submit(sess.id, 'q1')
    await flush()
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()
    await flush(20)                                       // 等空闲超时（30ms）→ endInput → query 退出 → running false
    expect(rt.isRunning(sess.id)).toBe(false)
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

  // 加固：claude query 异常终结（合成 turn_end failed）也会触发 onTurnEnd——此时 query 已死，绝不能 pushUser
  it('claude query 异常（throw→合成 turn_end failed）+ 队列有消息 → 不续投死 query、清队列、running false', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, 'q1')
    await flush()
    rt.submit(sess.id, 'q2')             // 入队
    // query 异常终结：interrupt 把 generator 强制完成（模拟进程死）。失败路径靠 onTurnEnd 的 failed 分支清队列
    // 这里用 result(failed) 模拟异常 turn 终结
    claude.emit({ type: 'result', subtype: 'error_during_execution', is_error: true, usage: { input_tokens: 1, output_tokens: 0 } })
    await flush()
    // 失败 turn → 清队列、不 pushUser；query 完成后 running false
    expect(claude.instances.length).toBe(1)            // 没起新 query
    expect(claude.current().received).toEqual(['q1'])  // 没把 q2 推给死 query
    expect(rt.isRunning(sess.id)).toBe(false)
  })
})

describe('SessionRuntime 消息附件（contextFiles）', () => {
  let dirs: string[] = []
  afterEach(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); dirs = [] })
  function realProject(engine: 'claude' | 'codex', transcriptDir?: string) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-')); dirs.push(work)
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: work })
    const sess = createSession(db, { projectId: proj.id, engine, model: engine === 'claude' ? 'opus' : 'gpt-5' })
    const children: any[] = []
    const spawnFn = ((bin: string, args: string[]) => { const cp = fakeChild(); cp.spawnArgs = args; children.push(cp); return cp }) as any
    const claude = fakeClaudeQuery()
    const rt = new SessionRuntime({ db, resolveBin: () => '/abs/bin', spawnFn, claudeQueryFn: claude.queryFn as any, transcriptDir })
    return { db, work, sess, rt, children, claude }
  }

  it('项目内附件：transcript 写 user_prompt（含 attachments）；引擎 prompt 带 preamble；messages 表无写入', () => {
    const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-')); dirs.push(transcriptDir)
    const { db, work, sess, rt, children } = realProject('codex', transcriptDir)
    fs.mkdirSync(path.join(work, 'attachments')); fs.writeFileSync(path.join(work, 'attachments', 'a.png'), 'x')
    rt.submit(sess.id, '看下这张图', ['attachments/a.png'])
    // transcript 里有 user_prompt，raw 包含原文 + attachments
    const rec = readRecords(transcriptDir, sess.id)[0]
    expect(rec).toMatchObject({ type: 'user_prompt', raw: { text: '看下这张图' } })
    expect((rec.raw as any).attachments).toContainEqual({ name: 'a.png', path: 'attachments/a.png' })
    // messages 表无写入
    expect(getMessages(db, sess.id)).toHaveLength(0)
    // 引擎 prompt（codex 原样文本）带 preamble
    expect(children[0].stdinWrites[0]).toBe('看下这张图\n\nAttached project files: `attachments/a.png`')
  })

  it('项目外附件：claude SDK options.additionalDirectories 含该文件所在目录', () => {
    const { sess, rt, claude } = realProject('claude')
    const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'as-ext-')); dirs.push(ext)
    const f = path.join(ext, 'doc.pdf'); fs.writeFileSync(f, 'x')
    rt.submit(sess.id, '读这个', [f])
    expect(claude.current().options.additionalDirectories).toContain(ext)
  })

  it('无 contextFiles：transcript 写 user_prompt（无附件），prompt 不带 preamble（回归）', () => {
    const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-')); dirs.push(transcriptDir)
    const { db, sess, rt, children } = realProject('codex', transcriptDir)
    rt.submit(sess.id, '纯文本')
    // transcript 记录 user_prompt，attachments 为空数组
    expect(readRecords(transcriptDir, sess.id)[0]).toMatchObject({ type: 'user_prompt', raw: { text: '纯文本', attachments: [] } })
    // messages 表无写入
    expect(getMessages(db, sess.id)).toHaveLength(0)
    expect(children[0].stdinWrites[0]).toBe('纯文本')
  })

  it('claude 运行中排队消息引用新外部目录 → 不 pushUser 到当前 query，排空后新 query 带累积 additionalDirectories', async () => {
    const { sess, rt, claude } = realProject('claude')
    const extA = fs.mkdtempSync(path.join(os.tmpdir(), 'as-extA-')); dirs.push(extA); fs.writeFileSync(path.join(extA, 'a'), '1')
    const extB = fs.mkdtempSync(path.join(os.tmpdir(), 'as-extB-')); dirs.push(extB); fs.writeFileSync(path.join(extB, 'b'), '2')
    rt.submit(sess.id, 'm1', [path.join(extA, 'a')])          // query1 带 additionalDirectories=[extA]
    await flush()
    rt.submit(sess.id, 'm2', [path.join(extB, 'b')])          // 运行中入队，引用新目录 extB
    claude.emit({ type: 'system', subtype: 'init', session_id: 's-1' })
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()
    // extB 未授权给 query1 → 不 pushUser、改 endInput 排空；query1 完成 → 起 query2
    expect(claude.instances.length).toBe(2)
    // q1 只收到 m1（带附件 preamble），没把 m2 推给它；q2 收到 m2
    expect(claude.instances[0].received).toHaveLength(1)
    expect(claude.instances[0].received[0]).toMatch(/^m1/)
    expect(claude.instances[1].received[0]).toMatch(/^m2/)
    // query2 的 additionalDirectories 累积 extA + extB
    const dirs2: string[] = claude.instances[1].options.additionalDirectories
    expect(dirs2).toContain(extA); expect(dirs2).toContain(extB)
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

  it('claude interrupt：合成 turn_end(aborted) → status aborted、running false（SDK interrupt 不吐 result 也兜底）', async () => {
    const { db, sess, rt, claude } = setup('claude')
    rt.subscribe(sess.id, () => {})
    rt.submit(sess.id, 'q1')
    await flush()
    rt.interrupt(sess.id)
    await flush()
    expect(claude.current().interrupts).toBe(1)
    expect(getSession(db, sess.id)).toMatchObject({ status: 'aborted' })
    expect(rt.isRunning(sess.id)).toBe(false)
  })

  it('dispose（删除会话）：停掉活进程 + 清内存；中断收尾被 disposed 守卫拦下，不回写 DB（对比 interrupt 不写 status=aborted）', async () => {
    const { db, sess, rt, children } = setup('codex')
    rt.submit(sess.id, 'q1')
    const cp = children[0]
    rt.dispose(sess.id)
    expect(cp.killSignals).toContain('SIGTERM')        // 底层进程被停
    expect(rt.isRunning(sess.id)).toBe(false)           // 内存状态已摘除
    cp.emit('close', null, 'SIGTERM')                   // 中断退出 → 本会触发 onTurnEnd(aborted)
    await new Promise((r) => setImmediate(r))
    // 关键：disposed 守卫拦下 onTurnEnd → status 未被改写（interrupt 会写 aborted，dispose 不会），即将被删的会话不产生回写
    expect(getSession(db, sess.id)).toMatchObject({ status: 'idle' })
  })
})

describe('SessionRuntime 运行时档位（claude 权限/思考强度）', () => {
  it('submit 带 runtime 档位 → 起 query 传 permissionMode/effort；运行中再 submit 变更 → 热切换', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, 'q1', [], { permissionMode: 'plan', effort: 'high' })
    await flush()
    expect(claude.current().options).toMatchObject({ permissionMode: 'plan', effort: 'high' })
    // 运行中变更权限档 → 对活 query 热切换（不重起）
    rt.submit(sess.id, 'q2', [], { permissionMode: 'acceptEdits' })
    await flush()
    expect(claude.current().setPermissionMode).toContain('acceptEdits')
    expect(claude.instances.length).toBe(1)
  })

  it('submit 带 model → 起 query 传 model；运行中改 model → setModel 热切换（不重起）', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, 'q1', [], { model: 'opus[1m]' })
    await flush()
    expect(claude.current().options).toMatchObject({ model: 'opus[1m]' })
    rt.submit(sess.id, 'q2', [], { model: 'sonnet' })
    await flush()
    expect(claude.current().setModel).toContain('sonnet')
    expect(claude.instances.length).toBe(1)
  })

  it('setRuntimeConfig 改 model → 落库 + 热切换（不发消息）', async () => {
    const { sess, rt, claude, db } = setup('claude')
    rt.submit(sess.id, 'q1', [], { model: 'opus' })
    await flush()
    rt.setRuntimeConfig(sess.id, { model: 'haiku' })
    await flush()
    expect(claude.current().setModel).toContain('haiku')
    void db   // 落库由 routes 层 setSessionRuntime 负责（见 sessions.test.ts），此处验热切换
  })

  it('resolveDecision 委托给活 claude handle（无活会话静默忽略不抛）', async () => {
    const { sess, rt } = setup('claude')
    expect(() => rt.resolveDecision(sess.id, 'nope', { behavior: 'allow' })).not.toThrow()
  })
})
