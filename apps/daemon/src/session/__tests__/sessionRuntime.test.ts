import { describe, it, expect, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { openDatabase } from '../../db/database'
import { createProject } from '../../db/projects'
import { createSession, getSession } from '../../db/sessions'
import { getUsage } from '../../db/usage'
import { readRecords } from '../transcript'
import { SessionRuntime } from '../sessionRuntime'
import type { RunState } from '../sessionRuntime'
import { fakeCodexClient } from '../../runtimes/codex/__tests__/fakeCodexClient'
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
    const inst: any = { options: args.options, received: [] as string[], contents: [] as any[], uuids: [] as (string | undefined)[], emitQ: [] as any[], waiting: null as any, inputEnded: false, genDone: false, interrupts: 0, setPermissionMode: [] as string[], applyFlagSettings: [] as any[], setModel: [] as string[] }
    instances.push(inst)
    const maybeComplete = () => { if (inst.inputEnded && inst.emitQ.length === 0 && inst.waiting) { const w = inst.waiting; inst.waiting = null; inst.genDone = true; w({ done: true, value: undefined }) } }
    inst.maybeComplete = maybeComplete
    ;(async () => { for await (const m of args.prompt) { const content = m?.message?.content; inst.contents.push(content); inst.uuids.push(m?.uuid); const t = Array.isArray(content) ? content.find((b: any) => b?.type === 'text')?.text : undefined; if (typeof t === 'string') inst.received.push(t) } inst.inputEnded = true; maybeComplete() })()
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
      supportedModels: async () => [], supportedCommands: async () => [{ name: 'plan', description: '进入计划模式', argumentHint: '' }], rewindFiles: async () => ({ canRewind: true }),
    }
    return inst.q
  }
  const emit = (msg: any) => { const inst = instances.at(-1); if (inst.waiting) { const w = inst.waiting; inst.waiting = null; w({ done: false, value: msg }) } else inst.emitQ.push(msg) }
  return { queryFn, instances, current: () => instances.at(-1), emit }
}

/** 默认探针结果：与活会话/会话桶的 'plan'/'review' 区分开，便于断言「四态回落到 cwd 探针」而非串到 live 缓存。 */
const PROBE_CMDS = [{ name: 'probed', description: 'cwd 探针命令', argumentHint: '' }]

function setup(
  engine: 'claude' | 'codex' = 'codex',
  opts: { transcriptDir?: string; probeResult?: any[]; probeCommandsFn?: any } = {},
) {
  const db = openDatabase(':memory:')
  const proj = createProject(db, { name: 'p', path: '/work' })
  const sess = createSession(db, { projectId: proj.id, engine, model: engine === 'claude' ? 'opus' : 'gpt-5' })
  const children: any[] = []
  const spawnFn = (() => { const cp = fakeChild(); children.push(cp); return cp }) as any
  const claude = fakeClaudeQuery()
  const codex = fakeCodexClient()
  // 假命令探针：记录每次调用的 cwd/addDirs（验证去重/指纹），默认返回 PROBE_CMDS（与 live 缓存区分）
  const probeCalls: Array<{ cwd: string; addDirs?: string[] }> = []
  const probeCommandsFn = opts.probeCommandsFn ?? (async (o: { cwd: string; addDirs?: string[] }) => { probeCalls.push(o); return opts.probeResult ?? PROBE_CMDS })
  const rt = new SessionRuntime({ db, resolveBin: () => '/abs/bin', spawnFn, claudeQueryFn: claude.queryFn as any, codexClientFactory: codex.factory, probeCommandsFn, transcriptDir: opts.transcriptDir })
  return { db, proj, sess, rt, children, claude, codex, probeCalls }
}

describe('RunState 判别式联合：非法态不可表达（类型级守卫）', () => {
  it('codex 运行态访问 claude 专属档位 → 编译期报错（@ts-expect-error 守住）', () => {
    const codexRun: Extract<RunState, { kind: 'codex' }> = { kind: 'codex', serverAlive: false }
    // @ts-expect-error codex 运行态无 permissionMode（claude 专属，不可表达）
    void codexRun.permissionMode
    // @ts-expect-error codex 运行态无 queryAlive（codex 用 serverAlive，无 queryAlive）
    void codexRun.queryAlive
    // @ts-expect-error codex 运行态无 outputFormat（claude 结构化输出专属，不可表达）
    void codexRun.outputFormat
    // codex 自有档位（sandbox/approval/effort/serverAlive/idleTimer）：可访问，不报错
    void codexRun.sandbox; void codexRun.approval; void codexRun.effort; void codexRun.serverAlive
    expect(codexRun.kind).toBe('codex')
  })
})

describe('SessionRuntime 单轮闭环', () => {
  it('codex submit：起 app-server→事件 fan-out→turn_end 落库（assistant message + usage + status completed + turn=1）', async () => {
    const { db, sess, rt, codex } = setup('codex')
    const seen: AgentEvent[] = []
    rt.subscribe(sess.id, (e) => seen.push(e))
    rt.submit(sess.id, '你好')
    await flush()   // 等 boot 链（initialize→thread/start→turn/start）跑完

    const c = codex.current()
    // boot 序列：initialize → thread/start → turn/start
    expect(c.requests.map((r: any) => r.method)).toEqual(['initialize', 'thread/start', 'turn/start'])
    // codex 一轮（JSON-RPC 通知）：turn/started → agentMessage 定格 → tokenUsage → turn/completed(completed)
    c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    c.notify('item/completed', { item: { type: 'agentMessage', id: 'msg-1', text: '回答' } })
    c.notify('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 5, outputTokens: 7 } } })
    c.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
    await flush()

    // 订阅者收到 turn_start（running 入口）→ message/usage/turn_end
    expect(seen.map((e) => e.type)).toEqual(['turn_start', 'message', 'usage', 'turn_end'])
    // usage turn=1
    expect(getUsage(db, sess.id)).toMatchObject([{ turn: 1, inputTokens: 5, outputTokens: 7 }])
    // status completed + resumable_id（= codex thread_id）落库
    expect(getSession(db, sess.id)).toMatchObject({ status: 'completed', resumableId: 'th-1' })
    // 常驻保活：turn 结束后 app-server 不退（client 未 close），running 归 false
    expect(rt.isRunning(sess.id)).toBe(false)
    expect(c.closes).toEqual([])   // 没 close，保活
  })

  it('codex submit：user 消息在 submit 时立即写入 transcript', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { sess, rt } = setup('codex', { transcriptDir: dir })
      rt.submit(sess.id, '先记一笔')
      // transcript 立即有 user_prompt 记录
      expect(readRecords(dir, sess.id)[0]).toMatchObject({ type: 'user_prompt', raw: { text: '先记一笔' } })
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('claude：activeFile → 推给 SDK 的 prompt 末尾带 <current_file> 块', async () => {
    const { rt, sess, claude } = setup('claude')
    rt.submit(sess.id, '帮我看下', [], undefined, 'src/foo.ts')
    await flush()
    const received = claude.current().received.join('\n')
    expect(received).toContain('<current_file>src/foo.ts</current_file>')
  })

  it('失败 turn（turn/completed status=failed）→ status failed，不 recordUsage', async () => {
    const { db, sess, rt, codex } = setup('codex')
    rt.submit(sess.id, 'x')
    await flush()
    const c = codex.current()
    c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    c.notify('turn/completed', { turn: { id: 'turn-1', status: 'failed', error: { message: 'upstream 503' } } })
    await flush()
    expect(getSession(db, sess.id)).toMatchObject({ status: 'failed' })
    expect(getUsage(db, sess.id)).toEqual([])
  })

  it('claude 流式文本：onTurnEnd 落库前折叠堆叠的流式块（重载===实时，不重复）', async () => {
    const trDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { sess, rt, claude } = setup('claude', { transcriptDir: trDir })
      rt.subscribe(sess.id, () => {})
      rt.submit(sess.id, 'hi')
      await flush()
      // 模拟 SDK 流式：start → 多个 text_delta（产生多帧 message(streaming:true)）→ stop（定格 message(streaming:false)）
      claude.emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
      claude.emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'I will' } } })
      claude.emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: ' start now' } } })
      claude.emit({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } })
      claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
      await flush()
      // 重载源 = 落库的 assistant_blocks：流式堆叠的多块应被折叠成 1 块，不再「重复」
      const ab = readRecords(trDir, sess.id).find((r) => r.type === 'assistant_blocks')
      const texts = ((ab?.raw as any).blocks as any[]).filter((b) => b.type === 'text')
      expect(texts).toHaveLength(1)
      expect(texts[0].text).toBe('I will start now')
    } finally { fs.rmSync(trDir, { recursive: true, force: true }) }
  })

  it('claude：user_prompt transcript 记录带 checkpointId，且 = 该 prompt 在 SDKUserMessage 上的 uuid（逐条 rewind 前置）', async () => {
    const trDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { sess, rt, claude } = setup('claude', { transcriptDir: trDir })
      rt.submit(sess.id, 'q1')
      await flush()
      const rec = readRecords(trDir, sess.id).find((r) => r.type === 'user_prompt')
      const ckpt = (rec?.raw as any).checkpointId
      expect(typeof ckpt).toBe('string')
      expect(ckpt).toBeTruthy()
      // 单一来源：transcript 记录的 checkpointId 与 SDK 收到的 user 消息 uuid 同值（rewindFiles 据此回退到该条前状态）
      expect(claude.current().uuids[0]).toBe(ckpt)
    } finally { fs.rmSync(trDir, { recursive: true, force: true }) }
  })

  it('claude 续投：第二条 user_prompt 记录带各自 checkpointId（每条独立，逐条可回退）', async () => {
    const trDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { sess, rt, claude } = setup('claude', { transcriptDir: trDir })
      rt.submit(sess.id, 'q1')
      await flush()
      claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
      await flush()                        // q1 完成、query 保活
      rt.submit(sess.id, 'q2')             // 空闲续投同一 query
      await flush()
      const recs = readRecords(trDir, sess.id).filter((r) => r.type === 'user_prompt')
      expect(recs).toHaveLength(2)
      const ck1 = (recs[0].raw as any).checkpointId
      const ck2 = (recs[1].raw as any).checkpointId
      expect(ck1).toBeTruthy(); expect(ck2).toBeTruthy()
      expect(ck1).not.toBe(ck2)            // 两条各有独立检查点
      // 与 SDK 收到的两条 user 消息 uuid 一一对应
      expect(claude.current().uuids).toEqual([ck1, ck2])
    } finally { fs.rmSync(trDir, { recursive: true, force: true }) }
  })

  it('codex：user_prompt 记录不带 checkpointId（无文件检查点能力）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { sess, rt } = setup('codex', { transcriptDir: dir })
      rt.submit(sess.id, 'x')
      const rec = readRecords(dir, sess.id)[0]
      expect(rec).toMatchObject({ type: 'user_prompt', raw: { text: 'x' } })
      expect((rec.raw as any).checkpointId).toBeUndefined()
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
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

  it('claude 续投：每个新轮都发 turn_start（startTurn 首轮 + queryAlive 续投轮）', async () => {
    const { sess, rt, claude } = setup('claude')
    const seen: AgentEvent[] = []
    rt.subscribe(sess.id, (e) => seen.push(e))
    rt.submit(sess.id, 'q1')                          // 首轮 startTurn → turn_start #1
    await flush()
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()                                     // q1 完成、query 保活
    rt.submit(sess.id, 'q2')                          // 空闲续投 pushUser → turn_start #2
    await flush()
    expect(seen.filter((e) => e.type === 'turn_start')).toHaveLength(2)
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

  it('codex 运行中续投：turn 进行时 submit→入队；turn/completed 后 pushUser 同一 app-server、不新起进程（常驻保活）', async () => {
    const { sess, rt, codex } = setup('codex')
    rt.submit(sess.id, 'q1')
    await flush()
    const c = codex.current()
    c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    rt.submit(sess.id, 'q2')                         // 运行中 → 入队
    expect(codex.instances.length).toBe(1)           // 没起新 client
    c.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
    await flush()
    // 队列有 q2 → pushUser 同一 client（不新起进程），client 仍是同一个
    expect(codex.instances.length).toBe(1)
    // 第二个 turn/start 发到同一 client（q2 文本）
    const turnStarts = c.requests.filter((r: any) => r.method === 'turn/start')
    expect(turnStarts).toHaveLength(2)
    expect((turnStarts[1].params as any).input[0].text).toBe('q2')
    expect(rt.isRunning(sess.id)).toBe(true)
    expect(c.closes).toEqual([])                     // 保活，未 close
  })

  it('codex 空闲续投：q1 完成后保活（running false 但 server 不退）→ 空闲 submit q2 复用同 client pushUser（不重 spawn）', async () => {
    const { sess, rt, codex } = setup('codex')
    rt.submit(sess.id, 'q1')
    await flush()
    const c = codex.current()
    c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    c.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
    await flush()                                    // q1 完成 → 保活、running false
    expect(rt.isRunning(sess.id)).toBe(false)
    expect(codex.instances.length).toBe(1)
    rt.submit(sess.id, 'q2')                         // 空闲态续投 → 复用同 client pushUser
    await flush()
    expect(codex.instances.length).toBe(1)           // 没起新 client
    const turnStarts = c.requests.filter((r) => r.method === 'turn/start')
    expect((turnStarts.at(-1)!.params as any).input[0].text).toBe('q2')
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
    const codex = fakeCodexClient()
    const rt = new SessionRuntime({ db, resolveBin: () => '/abs/bin', spawnFn, claudeQueryFn: claude.queryFn as any, codexClientFactory: codex.factory, transcriptDir })
    return { db, work, sess, rt, children, claude, codex }
  }

  it('项目内附件：transcript 写 user_prompt（含 attachments）；引擎 prompt 带 preamble', async () => {
    const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-')); dirs.push(transcriptDir)
    const { work, sess, rt, codex } = realProject('codex', transcriptDir)
    fs.mkdirSync(path.join(work, 'attachments')); fs.writeFileSync(path.join(work, 'attachments', 'a.png'), 'x')
    rt.submit(sess.id, '看下这张图', ['attachments/a.png'])
    await flush()
    // transcript 里有 user_prompt，raw 包含原文 + attachments
    const rec = readRecords(transcriptDir, sess.id)[0]
    expect(rec).toMatchObject({ type: 'user_prompt', raw: { text: '看下这张图' } })
    expect((rec.raw as any).attachments).toContainEqual({ name: 'a.png', path: 'attachments/a.png' })
    // 引擎 prompt（codex 原样文本）带 preamble → 经 turn/start.input[0].text 透传
    const turnStart = codex.current().requests.find((r) => r.method === 'turn/start')!
    expect((turnStart.params as any).input[0].text).toBe('看下这张图\n\nAttached project files: `attachments/a.png`')
  })

  it('项目外附件：claude SDK options.additionalDirectories 含该文件所在目录', () => {
    const { sess, rt, claude } = realProject('claude')
    const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'as-ext-')); dirs.push(ext)
    const f = path.join(ext, 'doc.pdf'); fs.writeFileSync(f, 'x')
    rt.submit(sess.id, '读这个', [f])
    expect(claude.current().options.additionalDirectories).toContain(ext)
  })

  it('无 contextFiles：transcript 写 user_prompt（无附件），prompt 不带 preamble（回归）', async () => {
    const transcriptDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-')); dirs.push(transcriptDir)
    const { sess, rt, codex } = realProject('codex', transcriptDir)
    rt.submit(sess.id, '纯文本')
    await flush()
    // transcript 记录 user_prompt，attachments 为空数组
    expect(readRecords(transcriptDir, sess.id)[0]).toMatchObject({ type: 'user_prompt', raw: { text: '纯文本', attachments: [] } })
    const turnStart = codex.current().requests.find((r) => r.method === 'turn/start')!
    expect((turnStart.params as any).input[0].text).toBe('纯文本')
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

describe('SessionRuntime 图片内联（仅 claude）', () => {
  let dirs: string[] = []
  afterEach(() => { for (const d of dirs) fs.rmSync(d, { recursive: true, force: true }); dirs = [] })
  function realProject(engine: 'claude' | 'codex', transcriptDir?: string) {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'as-img-rt-')); dirs.push(work)
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: work })
    const sess = createSession(db, { projectId: proj.id, engine, model: engine === 'claude' ? 'opus' : 'gpt-5' })
    const children: any[] = []
    const spawnFn = ((bin: string, args: string[]) => { const cp = fakeChild(); cp.spawnArgs = args; children.push(cp); return cp }) as any
    const claude = fakeClaudeQuery()
    const codex = fakeCodexClient()
    const rt = new SessionRuntime({ db, resolveBin: () => '/abs/bin', spawnFn, claudeQueryFn: claude.queryFn as any, codexClientFactory: codex.factory, transcriptDir })
    return { db, work, sess, rt, children, claude, codex }
  }
  function writePng(work: string, rel = 'attachments/a.png'): void {
    const abs = path.join(work, rel); fs.mkdirSync(path.dirname(abs), { recursive: true }); fs.writeFileSync(abs, Buffer.alloc(10, 1))
  }

  it('claude 首轮：项目内图片 → 内联 base64 image 块；preamble 不含该图路径', async () => {
    const { work, sess, rt, claude } = realProject('claude')
    writePng(work)
    rt.submit(sess.id, '看下这张图', ['attachments/a.png'])
    await flush()
    const content = claude.current().contents[0]
    expect(content[0]).toMatchObject({ type: 'image', source: { type: 'base64', media_type: 'image/png' } })
    expect(content.at(-1)).toMatchObject({ type: 'text', text: '看下这张图' })   // 纯图无 preamble
    expect(JSON.stringify(content)).not.toContain('Attached project files')
  })

  it('claude 图文混合：图片内联、非图片走 preamble（同条消息分流）', async () => {
    const { work, sess, rt, claude } = realProject('claude')
    writePng(work)
    fs.writeFileSync(path.join(work, 'attachments', 'n.md'), 'hi')
    rt.submit(sess.id, '看图读文', ['attachments/a.png', 'attachments/n.md'])
    await flush()
    const content = claude.current().contents[0]
    expect(content.filter((b: any) => b.type === 'image')).toHaveLength(1)
    const text = content.find((b: any) => b.type === 'text').text
    expect(text).toContain('Attached project files: `attachments/n.md`')   // 非图走 preamble
    expect(text).not.toContain('a.png')                                     // 图片不在 preamble
  })

  it('codex：图片不内联，路径仍走 preamble（无 image 块，回归）', async () => {
    const { work, sess, rt, codex } = realProject('codex')
    writePng(work)
    rt.submit(sess.id, '看下这张图', ['attachments/a.png'])
    await flush()
    // codex 无图片内联：图片路径仍走 preamble，整段文本经 turn/start.input[0].text 透传（无 image 块）
    const turnStart = codex.current().requests.find((r) => r.method === 'turn/start')!
    expect((turnStart.params as any).input[0].text).toBe('看下这张图\n\nAttached project files: `attachments/a.png`')
  })

  it('claude 空闲续投：第二轮带图 → 复用同 query pushUser 带 image 块', async () => {
    const { work, sess, rt, claude } = realProject('claude')
    writePng(work)
    rt.submit(sess.id, 'q1')
    await flush()
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()   // q1 完成，query 保活
    rt.submit(sess.id, '看图', ['attachments/a.png'])   // 空闲续投带图
    await flush()
    expect(claude.instances.length).toBe(1)             // 复用同 query
    const content2 = claude.current().contents[1]
    expect(content2[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } })
  })

  it('claude 运行中入队：排队消息带图 → turn_end 后 pushUser 带 image 块', async () => {
    const { work, sess, rt, claude } = realProject('claude')
    writePng(work)
    rt.submit(sess.id, 'q1')
    await flush()
    rt.submit(sess.id, '看图', ['attachments/a.png'])   // 运行中入队
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()
    const content2 = claude.current().contents[1]
    expect(content2[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } })
  })

  it('claude 排队重启 query（队列项引用新外部目录）→ onDone 起新 query 首条 content 带 image 块', async () => {
    const { work, sess, rt, claude } = realProject('claude')
    writePng(work)
    const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'as-img-ext-')); dirs.push(ext)
    fs.writeFileSync(path.join(ext, 'doc.pdf'), 'x')
    rt.submit(sess.id, 'm1')                            // query1 起，无外部目录
    await flush()
    rt.submit(sess.id, '看图读外部', ['attachments/a.png', path.join(ext, 'doc.pdf')])   // 运行中入队，引用新外部目录
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()
    // ext 未授权 → 排空 → onDone 起 query2，带图
    expect(claude.instances.length).toBe(2)
    const content2 = claude.instances[1].contents[0]
    expect(content2[0]).toMatchObject({ type: 'image', source: { media_type: 'image/png' } })
  })

  it('claude：内联图片后 transcript 仍记录全部 listed（含图片路径，供 ChatLog 缩略图回显）', async () => {
    const trDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-img-tr-')); dirs.push(trDir)
    const { work, sess, rt, claude } = realProject('claude', trDir)
    writePng(work)
    rt.submit(sess.id, '看图', ['attachments/a.png'])
    await flush()
    const rec = readRecords(trDir, sess.id)[0]
    expect((rec.raw as any).attachments).toContainEqual({ name: 'a.png', path: 'attachments/a.png' })
  })
})

describe('SessionRuntime 子代理归属落库（parentToolUseId 持久化，F1）', () => {
  it('claude：子代理块的 parentToolUseId 随 assistant_blocks 落库 → 重载后可重建形态 A/B 嵌套', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { sess, rt, claude } = setup('claude', { transcriptDir: dir })
      rt.subscribe(sess.id, () => {})
      rt.submit(sess.id, 'q1')
      await flush()
      // 主线：派生子代理的 Task tool_use（无 parent）
      claude.emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Task', input: { subagent_type: 'general-purpose', description: 'x' } }] } })
      // 子代理内部：带顶层 parent_tool_use_id 的 tool_use（text 会被流式去重，故以 tool_use 验证归属落库）
      claude.emit({ type: 'assistant', parent_tool_use_id: 'tu1', message: { content: [{ type: 'tool_use', id: 'r1', name: 'Read', input: { file_path: 'a' } }] } })
      claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
      await flush()
      const rec = readRecords(dir, sess.id).find((r) => r.type === 'assistant_blocks')!
      const blocks = (rec.raw as { blocks: Array<Record<string, unknown>> }).blocks
      const task = blocks.find((b) => b.id === 'tu1')!
      const read = blocks.find((b) => b.id === 'r1')!
      expect(task).toMatchObject({ type: 'tool_use', name: 'Task' })
      expect(task.parentToolUseId).toBeUndefined()                 // 主线 Task 块无归属
      expect(read).toMatchObject({ type: 'tool_use', parentToolUseId: 'tu1' })   // 子代理块归属落库（关键）
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('claude：task_started.skip_transcript 回填到 Task 块并落库（Task 块先到，back-fill；§9.5 重载仍成立）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { sess, rt, claude } = setup('claude', { transcriptDir: dir })
      rt.subscribe(sess.id, () => {})
      rt.submit(sess.id, 'q1')
      await flush()
      claude.emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Task', input: { subagent_type: 'web-research', description: 'x' } }] } })
      claude.emit({ type: 'system', subtype: 'task_started', task_id: 'tk1', tool_use_id: 'tu1', subagent_type: 'web-research', description: 'x', skip_transcript: true })
      claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
      await flush()
      const rec = readRecords(dir, sess.id).find((r) => r.type === 'assistant_blocks')!
      const blocks = (rec.raw as { blocks: Array<Record<string, unknown>> }).blocks
      expect(blocks.find((b) => b.id === 'tu1')).toMatchObject({ type: 'tool_use', name: 'Task', skipTranscript: true })
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('claude：task_started 先于 Task 块到达时也能标记（skipToolUses set 兜底，不臆断 SDK 时序）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { sess, rt, claude } = setup('claude', { transcriptDir: dir })
      rt.subscribe(sess.id, () => {})
      rt.submit(sess.id, 'q1')
      await flush()
      // 反序：task_started 先到（Task 块尚未入 blocks）→ 记入 set；Task 块后到 → 落库时带上 skipTranscript
      claude.emit({ type: 'system', subtype: 'task_started', task_id: 'tk1', tool_use_id: 'tu2', subagent_type: 'web-research', description: 'x', skip_transcript: true })
      claude.emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu2', name: 'Task', input: { subagent_type: 'web-research', description: 'x' } }] } })
      claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
      await flush()
      const rec = readRecords(dir, sess.id).find((r) => r.type === 'assistant_blocks')!
      const blocks = (rec.raw as { blocks: Array<Record<string, unknown>> }).blocks
      expect(blocks.find((b) => b.id === 'tu2')).toMatchObject({ type: 'tool_use', name: 'Task', skipTranscript: true })
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('SessionRuntime codex 子代理状态持久化（codex_subagent 落 assistant_blocks，P5c）', () => {
  it('codex：codex_subagent 事件（spawned/item/status/report/wait）作块随 assistant_blocks 落库 → 重载可 replay', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { sess, rt, codex } = setup('codex', { transcriptDir: dir })
      rt.subscribe(sess.id, () => {})
      rt.submit(sess.id, 'q1')
      await flush()
      const c = codex.current()
      c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
      // 主代理 spawnAgent 编排 item（completed）→ 揭示子线程 sub-a + emit spawned + 主线锚点 tool_use(spawnAgent)
      c.notify('item/completed', {
        item: {
          type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'th-1',
          receiverThreadIds: ['sub-a'], prompt: '角色：writer-A\n写文件', agentsStates: { 'sub-a': { status: 'running' } },
        },
      })
      // 子线程 item（已知子 thread → 走子路由 → codex_subagent{phase:item}）
      c.notify('item/completed', { threadId: 'sub-a', item: { type: 'agentMessage', id: 'm1', text: '已写 AAA.txt' } })
      // wait 完成 → report + waiting:false
      c.notify('item/completed', {
        item: { type: 'collabAgentToolCall', tool: 'wait', senderThreadId: 'th-1', agentsStates: { 'sub-a': { status: 'completed', message: '完成：AAA.txt' } } },
      })
      c.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
      await flush()

      const rec = readRecords(dir, sess.id).find((r) => r.type === 'assistant_blocks')!
      const blocks = (rec.raw as { blocks: Array<Record<string, any>> }).blocks
      const subBlocks = blocks.filter((b) => b.type === 'codex_subagent')
      // 锚点 tool_use(spawnAgent) 随共享事件落库（renderer timelineMount 挂载点）
      expect(blocks.find((b) => b.type === 'tool_use' && b.name === 'spawnAgent')).toBeTruthy()
      // 子代理生命周期事件作块落库（spawned/item/status/report/wait），保留 threadId 归属 + phase
      expect(subBlocks.some((b) => b.phase === 'spawned' && b.threadId === 'sub-a' && b.parentThreadId === 'th-1')).toBe(true)
      expect(subBlocks.some((b) => b.phase === 'item' && b.threadId === 'sub-a' && b.item?.text === '已写 AAA.txt')).toBe(true)
      expect(subBlocks.some((b) => b.phase === 'report' && b.threadId === 'sub-a' && b.report === '完成：AAA.txt')).toBe(true)
      expect(subBlocks.some((b) => b.phase === 'status' && b.threadId === 'sub-a')).toBe(true)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('codex：子消息流式增量帧不落库，只落定格帧（消除 transcript 膨胀）+ 非 message 帧全留', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { sess, rt, codex } = setup('codex', { transcriptDir: dir })
      const seen: AgentEvent[] = []
      rt.subscribe(sess.id, (e) => seen.push(e))
      rt.submit(sess.id, 'q1')
      await flush()
      const c = codex.current()
      c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
      // 揭示子线程 sub-a（spawnAgent 编排）
      c.notify('item/completed', {
        item: {
          type: 'collabAgentToolCall', tool: 'spawnAgent', senderThreadId: 'th-1',
          receiverThreadIds: ['sub-a'], prompt: '角色：A\n写文件', agentsStates: { 'sub-a': { status: 'running' } },
        },
      })
      // 子线程一条消息流式 3 段增量（codexAppServer 按 itemId 累计 → 3 个 streaming:true 帧）→ item/completed 定格全文
      c.notify('item/agentMessage/delta', { threadId: 'sub-a', itemId: 'm1', delta: '部' })
      c.notify('item/agentMessage/delta', { threadId: 'sub-a', itemId: 'm1', delta: '分内' })
      c.notify('item/agentMessage/delta', { threadId: 'sub-a', itemId: 'm1', delta: '容已写' })
      c.notify('item/completed', { threadId: 'sub-a', item: { type: 'agentMessage', id: 'm1', text: '部分内容已写' } })
      // 子线程 tool_use（非 message 帧，须保留）
      c.notify('item/started', { threadId: 'sub-a', item: { type: 'commandExecution', id: 't1', command: 'ls' } })
      c.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
      await flush()

      // live SSE 通路：流式帧照常推送（用户看到逐字增量）—— 共发 3 个 streaming:true message 帧
      const liveStreamMsgs = seen.filter(
        (e) => e.type === 'codex_subagent' && e.phase === 'item' && e.item?.kind === 'message' && e.item.streaming === true,
      )
      expect(liveStreamMsgs.length).toBe(3)

      // 落库：流式 message 帧全被丢，子线程只剩 1 个 message 块 = 定格全文（streaming 缺省）
      const rec = readRecords(dir, sess.id).find((r) => r.type === 'assistant_blocks')!
      const blocks = (rec.raw as { blocks: Array<Record<string, any>> }).blocks
      const subMsgBlocks = blocks.filter(
        (b) => b.type === 'codex_subagent' && b.phase === 'item' && b.item?.kind === 'message',
      )
      expect(subMsgBlocks).toHaveLength(1)
      expect(subMsgBlocks[0].item.text).toBe('部分内容已写')
      expect(subMsgBlocks[0].item.streaming).toBeUndefined()
      // 无任何流式帧落库
      expect(blocks.some((b) => b.type === 'codex_subagent' && b.item?.streaming === true)).toBe(false)
      // 非 message 帧（spawned / tool_use）照常保留
      expect(blocks.some((b) => b.type === 'codex_subagent' && b.phase === 'spawned' && b.threadId === 'sub-a')).toBe(true)
      expect(blocks.some((b) => b.type === 'codex_subagent' && b.phase === 'item' && b.item?.kind === 'tool_use' && b.item?.id === 't1')).toBe(true)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })

  it('claude：永不发 codex_subagent → assistant_blocks 不含任何 codex_subagent 块（不受本改动影响）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { sess, rt, claude } = setup('claude', { transcriptDir: dir })
      rt.subscribe(sess.id, () => {})
      rt.submit(sess.id, 'q1')
      await flush()
      claude.emit({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tu1', name: 'Read', input: { file_path: 'a' } }] } })
      claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
      await flush()
      const rec = readRecords(dir, sess.id).find((r) => r.type === 'assistant_blocks')!
      const blocks = (rec.raw as { blocks: Array<Record<string, any>> }).blocks
      expect(blocks.some((b) => b.type === 'codex_subagent')).toBe(false)
      expect(blocks.find((b) => b.id === 'tu1')).toBeTruthy()
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
  })
})

describe('SessionRuntime interrupt', () => {
  it('codex interrupt：发 turn/interrupt + 关 client、清空队列、合成 turn_end(aborted) 落 status=aborted', async () => {
    const { db, sess, rt, codex } = setup('codex')
    rt.submit(sess.id, 'q1')
    await flush()
    const c = codex.current()
    c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })   // turn 进行中（interrupt 必带 turnId）
    rt.submit(sess.id, 'q2')           // 入队
    rt.interrupt(sess.id)
    // driver 发了 turn/interrupt（带 threadId+turnId）+ close client
    expect(c.requests.some((r: any) => r.method === 'turn/interrupt')).toBe(true)
    expect(c.closes.length).toBeGreaterThan(0)
    await flush()
    // close → onExit 合成 turn_end(aborted) → status aborted
    expect(getSession(db, sess.id)).toMatchObject({ status: 'aborted' })
    // 队列已清空：不会起第二个 client
    expect(codex.instances.length).toBe(1)
    expect(rt.isRunning(sess.id)).toBe(false)
  })

  it('codex interrupt（turn/completed status=interrupted 到来）→ mapStatus aborted + run_note + 清队列（carry-forward #1）', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-rt-'))
    try {
      const { db, sess, rt, codex } = setup('codex', { transcriptDir: dir })
      rt.subscribe(sess.id, () => {})
      rt.submit(sess.id, 'q1')
      await flush()
      const c = codex.current()
      c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
      rt.submit(sess.id, 'q2')        // 入队
      // codex turn/interrupt 真链路：turn/completed.status=interrupted 到来（非合成）→ eventMap emit turn_end('interrupted')
      c.notify('turn/completed', { turn: { id: 'turn-1', status: 'interrupted' } })
      await flush()
      // 'interrupted' 归一为 aborted：status aborted + run_note 落库 + 队列清空（不续投 q2）
      expect(getSession(db, sess.id)).toMatchObject({ status: 'aborted' })
      const rec = readRecords(dir, sess.id).find((r) => r.type === 'assistant_blocks')!
      const blocks = (rec.raw as { blocks: Array<Record<string, unknown>> }).blocks
      expect(blocks.find((b) => b.type === 'run_note')).toMatchObject({ stopReason: 'aborted' })
      // 第二个 turn/start 没发（队列已清，未续投 q2）
      expect(c.requests.filter((r: any) => r.method === 'turn/start')).toHaveLength(1)
    } finally { fs.rmSync(dir, { recursive: true, force: true }) }
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

  it('dispose（删除会话）：停掉活 app-server + 清内存；中断收尾被 disposed 守卫拦下，不回写 DB（对比 interrupt 不写 status=aborted）', async () => {
    const { db, sess, rt, codex } = setup('codex')
    rt.submit(sess.id, 'q1')
    await flush()
    const c = codex.current()
    c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    rt.dispose(sess.id)
    expect(c.closes.length).toBeGreaterThan(0)          // 底层 client 被关
    expect(rt.isRunning(sess.id)).toBe(false)           // 内存状态已摘除
    await flush()                                       // close → onExit 触发 onTurnEnd(aborted) / onDone
    // 关键：disposed 守卫拦下 onTurnEnd → status 未被改写（interrupt 会写 aborted，dispose 不会），即将被删的会话不产生回写
    expect(getSession(db, sess.id)).toMatchObject({ status: 'idle' })
  })
})

describe('SessionRuntime codex app-server 常驻保活 / 档位 / 决策（Part A P3.4）', () => {
  it('codex 续投：每个新轮都发 turn_start（startTurn 首轮 + serverAlive 续投轮）', async () => {
    const { sess, rt, codex } = setup('codex')
    const seen: AgentEvent[] = []
    rt.subscribe(sess.id, (e) => seen.push(e))
    rt.submit(sess.id, 'q1')                          // 首轮 startTurn → turn_start #1
    await flush()
    const c = codex.current()
    c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    c.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
    await flush()                                     // q1 完成、server 保活
    rt.submit(sess.id, 'q2')                          // 空闲续投 pushUser → turn_start #2
    await flush()
    expect(seen.filter((e) => e.type === 'turn_start')).toHaveLength(2)
  })

  it('codex onResumableId：thread_id 落库为会话 resume 指针（resumableId）', async () => {
    const { db, sess, rt, codex } = setup('codex')
    rt.submit(sess.id, 'q1')
    await flush()
    void codex   // thread/start 假 response thread.id='th-1' → onResumableId → setResumableId
    expect(getSession(db, sess.id)).toMatchObject({ resumableId: 'th-1' })
  })

  it('codex resume：会话有 resumableId → 走 thread/resume（不 thread/start），续接同 thread', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/work' })
    const sess = createSession(db, { projectId: proj.id, engine: 'codex', model: 'gpt-5' })
    db.prepare('UPDATE sessions SET resumable_id = ? WHERE id = ?').run('prev-thread', sess.id)
    const codex = fakeCodexClient()
    const rt = new SessionRuntime({ db, resolveBin: () => '/abs/bin', codexClientFactory: codex.factory })
    rt.submit(sess.id, 'go')
    await flush()
    const c = codex.current()
    expect(c.requests.map((r: any) => r.method)).toEqual(['initialize', 'thread/resume', 'turn/start'])
    expect((c.requests[1].params as any)).toEqual({ threadId: 'prev-thread' })
  })

  it('codex resolveDecision：分发到活 codex handle（结构兼容；无活会话静默忽略不抛）', async () => {
    const { sess, rt, codex } = setup('codex')
    // 无活会话 → 静默忽略
    expect(() => rt.resolveDecision(sess.id, 'nope', { behavior: 'allow' })).not.toThrow()
    // 起 server + 挂一个 server→client 审批请求（itemId=req-1, jsonRpcId=7）
    rt.submit(sess.id, 'q1')
    await flush()
    const c = codex.current()
    c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    c.serverRequest('item/commandExecution/requestApproval', 7, { itemId: 'req-1' })
    // resolveDecision 分发到 codex handle（Phase 4 才映射决策枚举回执；此处只验不抛 + 路由到 codex 分支）
    expect(() => rt.resolveDecision(sess.id, 'req-1', { behavior: 'allow' })).not.toThrow()
  })

  it('codex 档位：submit 带 sandbox/approval/effort → 起 thread/start 传 sandbox/approval、turn/start 传 effort', async () => {
    const { sess, rt, codex } = setup('codex')
    rt.submit(sess.id, 'q1', [], { sandbox: 'read-only', approval: 'on-request', effort: 'high' })
    await flush()
    const c = codex.current()
    const threadStart = c.requests.find((r) => r.method === 'thread/start')!
    expect(threadStart.params).toMatchObject({ sandbox: 'read-only', approvalPolicy: 'on-request' })
    const turnStart = c.requests.find((r) => r.method === 'turn/start')!
    expect((turnStart.params as any).effort).toBe('high')
  })

  it('codex 重水合：会话行持久化的 sandbox/approval → load() 注入 run 态 → 不带 runtime 的 submit 仍传给 thread/start（Part A P3）', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/work' })
    const sess = createSession(db, { projectId: proj.id, engine: 'codex', model: 'gpt-5', sandbox: 'danger-full-access', approval: 'never' })
    const codex = fakeCodexClient()
    // 全新 runtime（内存无缓存态）→ 首次 load 必从 DB 行重建 run 态
    const rt = new SessionRuntime({ db, resolveBin: () => '/abs/bin', codexClientFactory: codex.factory })
    rt.submit(sess.id, 'q1')   // 不带任何 runtime 档位
    await flush()
    const threadStart = codex.current().requests.find((r) => r.method === 'thread/start')!
    expect(threadStart.params).toMatchObject({ sandbox: 'danger-full-access', approvalPolicy: 'never' })
  })

  it('codex 空闲超时 → endInput 关闭 app-server（避免空闲进程长留）', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/work' })
    const sess = createSession(db, { projectId: proj.id, engine: 'codex', model: 'gpt-5' })
    const codex = fakeCodexClient()
    const rt = new SessionRuntime({ db, resolveBin: () => '/abs/bin', codexClientFactory: codex.factory, claudeSessionIdleMs: 30 })
    rt.subscribe(sess.id, () => {})
    rt.submit(sess.id, 'q1')
    await flush()
    const c = codex.current()
    c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    c.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
    await flush()                          // q1 完成 → server 保活、起空闲计时
    expect(c.closes).toEqual([])           // 还没超时，未关
    await new Promise((r) => setTimeout(r, 60))   // 等空闲超时（30ms）真实流逝 → endInput → close
    await flush()
    expect(c.closes.length).toBeGreaterThan(0)
    expect(rt.isRunning(sess.id)).toBe(false)
  })

  it('codex 排队消息引用新外部目录 → 不 pushUser 当前 server，排空后 onDone 起新 server 带累积 addDirs（沿用 thread_id）', async () => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), 'as-codex-ext-'))
    const ext = fs.mkdtempSync(path.join(os.tmpdir(), 'as-codex-extB-'))
    try {
      const db = openDatabase(':memory:')
      const proj = createProject(db, { name: 'p', path: work })
      const sess = createSession(db, { projectId: proj.id, engine: 'codex', model: 'gpt-5' })
      const codex = fakeCodexClient()
      const rt = new SessionRuntime({ db, resolveBin: () => '/abs/bin', codexClientFactory: codex.factory })
      fs.writeFileSync(path.join(ext, 'doc.pdf'), 'x')
      rt.submit(sess.id, 'm1')                          // server1 起，无外部目录
      await flush()
      const c1 = codex.current()
      c1.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
      rt.submit(sess.id, 'm2', [path.join(ext, 'doc.pdf')])   // 运行中入队，引用新外部目录
      c1.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
      await flush()
      // ext 未授权给 server1 → 不 pushUser、endInput 排空 → onDone 起 server2
      expect(codex.instances.length).toBe(2)
      const c2 = codex.current()
      // server2 走 thread/resume（沿用 thread_id 'th-1'），收到 m2
      expect(c2.requests.map((r: any) => r.method)).toEqual(['initialize', 'thread/resume', 'turn/start'])
      const turnStart = c2.requests.find((r) => r.method === 'turn/start')!
      expect((turnStart.params as any).input[0].text).toMatch(/^m2/)
    } finally { fs.rmSync(work, { recursive: true, force: true }); fs.rmSync(ext, { recursive: true, force: true }) }
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

describe('SessionRuntime 切到 bypassPermissions：延迟重起拿启动开关（不中途砍、不丢上下文）', () => {
  // bypass 的真本事 = 进程启动时的 --allow-dangerously-skip-permissions 开关（只能起进程时给）。
  // 活进程非 bypass 起的 → 中途切 bypass 只能改模式标签、补不回开关 → 必须在下一次 submit 的回合边界沿用 resumableId 重起新进程。
  it('空闲态切 bypass → 下一次 submit 重起新 query 带 dangerous-skip 开关 + 沿用 resumableId（历史不丢）', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, 'q1', [], { permissionMode: 'default' })   // query1 起于 default（无开关）
    await flush()
    expect(claude.current().options.permissionMode).toBe('default')
    expect(claude.current().options.allowDangerouslySkipPermissions).toBeFalsy()
    claude.emit({ type: 'system', subtype: 'init', session_id: 's-1' })   // 拿到 resumableId
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()                                                 // q1 完成，query 空闲保活
    rt.setRuntimeConfig(sess.id, { permissionMode: 'bypassPermissions' })   // 空闲态切绕过
    await flush()
    rt.submit(sess.id, 'q2')                                      // 下一轮 → 必须重起，而非 pushUser 复用
    await flush()
    expect(claude.instances.length).toBe(2)                       // 重起了新 query
    expect(claude.instances[1].options.permissionMode).toBe('bypassPermissions')
    expect(claude.instances[1].options.allowDangerouslySkipPermissions).toBe(true)   // 新进程带上启动开关
    expect(claude.instances[1].options.resume).toBe('s-1')        // 沿用 resumableId 续接 → 历史不丢
    expect(claude.instances[0].received).toEqual(['q1'])          // q2 没推给旧进程
    expect(claude.instances[1].received[0]).toBe('q2')            // q2 走新进程
  })

  it('跑动中切 bypass → 不对活进程热切（避免 CLI bypass_permissions_disabled 退出）、不杀进程、当前轮继续', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, 'q1', [], { permissionMode: 'default' })   // 跑动中（未 emit result）
    await flush()
    rt.setRuntimeConfig(sess.id, { permissionMode: 'bypassPermissions' })   // 跑动中切绕过
    await flush()
    expect(claude.current().setPermissionMode).not.toContain('bypassPermissions')   // 没热切（否则可能杀进程）
    expect(claude.instances.length).toBe(1)                       // 没重起/没杀
    expect(rt.isRunning(sess.id)).toBe(true)                      // 当前轮继续
  })

  it('跑动中切 bypass + 同时排队下一条 → 当前轮结束后回合边界重起新 query 投递排队消息（带开关 + resume）', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, 'q1', [], { permissionMode: 'default' })   // query1 跑动中
    await flush()
    claude.emit({ type: 'system', subtype: 'init', session_id: 's-1' })
    rt.setRuntimeConfig(sess.id, { permissionMode: 'bypassPermissions' })   // 跑动中切绕过（不热切死进程）
    rt.submit(sess.id, 'q2')                                       // 跑动中再发一条 → 入队
    await flush()
    expect(claude.instances.length).toBe(1)                        // 当前轮还在跑，未重起
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })   // 当前轮结束 → onTurnEnd 排空
    await flush()
    expect(claude.instances.length).toBe(2)                        // 排队的 q2 须在带开关的新进程跑 → 重起
    expect(claude.instances[1].options.permissionMode).toBe('bypassPermissions')
    expect(claude.instances[1].options.allowDangerouslySkipPermissions).toBe(true)
    expect(claude.instances[1].options.resume).toBe('s-1')         // 沿用 resumableId
    expect(claude.instances[0].received).toEqual(['q1'])           // q2 没推给旧进程
    expect(claude.instances[1].received[0]).toBe('q2')
  })

  it('切到非 bypass 档（plan）→ 仍热切 + 下一次 submit 复用同 query 不重起（边界：重起判定不过宽）', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, 'q1', [], { permissionMode: 'default' })
    await flush()
    claude.emit({ type: 'result', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    await flush()
    rt.setRuntimeConfig(sess.id, { permissionMode: 'plan' })      // 非 bypass 切换
    await flush()
    expect(claude.current().setPermissionMode).toContain('plan')  // 仍走热切
    rt.submit(sess.id, 'q2')
    await flush()
    expect(claude.instances.length).toBe(1)                       // 非 bypass 切换不触发重起
    expect(claude.current().received).toEqual(['q1', 'q2'])
  })
})

describe('SessionRuntime Provider creds 注入', () => {
  it('startTurn 把 active provider creds 注入 claude SDK 的 env（真实注入链）', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/work' })
    const sess = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    const claude = fakeClaudeQuery()
    const rt = new SessionRuntime({
      db,
      resolveBin: () => '/abs/bin',
      claudeQueryFn: claude.queryFn as any,
      resolveCreds: (engine) => engine === 'claude' ? { baseUrl: 'https://relay', apiKey: 'sk-1', keyEnv: 'auth_token' } : undefined,
    })
    rt.submit(sess.id, 'hi')
    await flush()
    const env = claude.current().options.env
    expect(env.ANTHROPIC_BASE_URL).toBe('https://relay')
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-1')
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('resolveCreds 返回 undefined（选默认）→ 不注入任何凭证变量（§2b 默认登录态）', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/work' })
    const sess = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    const claude = fakeClaudeQuery()
    const rt = new SessionRuntime({
      db,
      resolveBin: () => '/abs/bin',
      claudeQueryFn: claude.queryFn as any,
      resolveCreds: () => undefined,   // 选「默认」= 永不注入
    })
    rt.submit(sess.id, 'hi')
    await flush()
    const env = claude.current().options.env
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })
})

describe('claude supportedCommands 链路', () => {
  it('活会话：rt.supportedCommands 调句柄 supportedCommands() 并缓存其返回', async () => {
    const { sess, rt } = setup('claude')
    rt.submit(sess.id, '起一轮')
    await flush()
    const got = await rt.supportedCommands(sess.id)
    expect(got).toEqual([{ name: 'plan', description: '进入计划模式', argumentHint: '' }])
  })

  it('无活会话但跑过 claude：回最近缓存（首会话拉过即有）', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, '起一轮')
    await flush()
    await rt.supportedCommands(sess.id)   // 活会话拉一次 → 写缓存
    // 让本轮自然结束 + query 退出 → 无活句柄
    claude.emit({ type: 'result', subtype: 'success' })
    await flush()
    rt.interrupt(sess.id); await flush()
    const cached = await rt.supportedCommands(sess.id)
    expect(cached).toEqual([{ name: 'plan', description: '进入计划模式', argumentHint: '' }])
  })

  it('四态：从未跑过 claude 会话 → 走 cwd 探针返回命令（不再 null）', async () => {
    const { sess, rt, probeCalls } = setup('claude')
    const got = await rt.supportedCommands(sess.id)
    expect(got).toEqual(PROBE_CMDS)                 // 探针填充，非 null
    expect(probeCalls).toEqual([{ cwd: '/work', addDirs: [] }])   // 用该会话 cwd（project.path）探一次
  })

  it('四态：探针失败 → 返回 []（不再 null；前端无静态可回落）', async () => {
    const { sess, rt } = setup('claude', { probeCommandsFn: async () => [] })
    expect(await rt.supportedCommands(sess.id)).toEqual([])
  })

  it('四态：codex 会话不探 claude 命令 → []（commands 是 claude SDK 能力）', async () => {
    const { sess, rt, probeCalls } = setup('codex')
    expect(await rt.supportedCommands(sess.id)).toEqual([])
    expect(probeCalls).toEqual([])                  // 不对 codex 会话起 claude 探针
  })

  it('cwd 缓存：二次取数命中缓存、不重探', async () => {
    const { sess, rt, probeCalls } = setup('claude')
    await rt.supportedCommands(sess.id)
    await rt.supportedCommands(sess.id)
    expect(probeCalls.length).toBe(1)               // 同 cwd 第二次读缓存，探针只跑一次
  })

  it('cwd 探针并发去重：同 cwd 并发取数只探一次', async () => {
    let resolveProbe!: (v: any[]) => void
    const probeCommandsFn = () => new Promise<any[]>((res) => { resolveProbe = res })
    let calls = 0
    const wrapped = (o: any) => { calls++; return probeCommandsFn() }
    const { sess, rt } = setup('claude', { probeCommandsFn: wrapped })
    const p1 = rt.supportedCommands(sess.id)
    const p2 = rt.supportedCommands(sess.id)
    resolveProbe(PROBE_CMDS)
    const [a, b] = await Promise.all([p1, p2])
    expect(a).toEqual(PROBE_CMDS); expect(b).toEqual(PROBE_CMDS)
    expect(calls).toBe(1)                            // 并发同 cwd 只触发一次探针
  })

  it('活查询优先：有活句柄时用 live supportedCommands，不走 cwd 探针', async () => {
    const { sess, rt, probeCalls } = setup('claude')
    rt.submit(sess.id, '起一轮')
    await flush()
    const got = await rt.supportedCommands(sess.id)
    expect(got).toEqual([{ name: 'plan', description: '进入计划模式', argumentHint: '' }])
    expect(probeCalls).toEqual([])                   // 活会话不探针
  })

  it('commands_changed 系统消息：覆盖缓存（REPLACE 而非合并）', async () => {
    const { sess, rt, claude } = setup('claude')
    rt.submit(sess.id, '起一轮')
    await flush()
    await rt.supportedCommands(sess.id)   // 缓存 = init 快照（plan）
    // SDK 推送 commands_changed → onCommandsChanged 写缓存
    claude.emit({ type: 'system', subtype: 'commands_changed', commands: [{ name: 'review', description: '审查改动', argumentHint: '' }] })
    await flush()
    const got = await rt.supportedCommands(sess.id)
    expect(got).toEqual([{ name: 'review', description: '审查改动', argumentHint: '' }])
  })

  it('commands_changed 经 onEvent 扇出给订阅者（→ SSE 实时推前端，P1）', async () => {
    const { sess, rt, claude } = setup('claude')
    const seen: AgentEvent[] = []
    rt.subscribe(sess.id, (e) => seen.push(e))
    rt.submit(sess.id, '起一轮')
    await flush()
    const newCmds = [{ name: 'review', description: '审查改动', argumentHint: '' }]
    claude.emit({ type: 'system', subtype: 'commands_changed', commands: newCmds })
    await flush()
    const ev = seen.find((e) => e.type === 'commands_changed') as { type: string; commands: unknown[] } | undefined
    expect(ev).toBeDefined()
    expect(ev!.commands).toEqual(newCmds)
  })

  it('命令缓存按 sessionId 分桶：A 的缓存不串给 B，对 A 推 commands_changed 不影响 B', async () => {
    const { db, proj, sess: sessA, rt, claude } = setup('claude')
    // 同一 runtime 下再建第二个 claude 会话 B（B 从未跑过）
    const sessB = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })

    // A 跑一轮 + 拉命令 → A 有缓存
    rt.submit(sessA.id, '起一轮')
    await flush()
    const gotA = await rt.supportedCommands(sessA.id)
    expect(gotA).toEqual([{ name: 'plan', description: '进入计划模式', argumentHint: '' }])

    // B 从未跑过 → 走 cwd 探针（不串 A 的 live 缓存）：拿到的是探针结果而非 A 的 'plan'
    expect(await rt.supportedCommands(sessB.id)).toEqual(PROBE_CMDS)

    // 对 A 推 commands_changed（claude.emit 命中最近的 query 实例 = A）→ 只更新 A 的会话桶，B 不受影响（仍走探针）
    claude.emit({ type: 'system', subtype: 'commands_changed', commands: [{ name: 'review', description: '审查改动', argumentHint: '' }] })
    await flush()
    expect(await rt.supportedCommands(sessA.id)).toEqual([{ name: 'review', description: '审查改动', argumentHint: '' }])
    expect(await rt.supportedCommands(sessB.id)).toEqual(PROBE_CMDS)
  })
})

describe('claude 项目级命令（无会话入口 projectCommands）', () => {
  it('按 project.path 当 cwd 走同一 cwd 探针缓存', async () => {
    const { proj, rt, probeCalls } = setup('claude')
    const got = await rt.projectCommands(proj.id)
    expect(got).toEqual(PROBE_CMDS)
    expect(probeCalls).toEqual([{ cwd: '/work', addDirs: [] }])
  })

  it('项目不存在 → []（route 层另做 404；运行时只回空）', async () => {
    const { rt } = setup('claude')
    expect(await rt.projectCommands('nope')).toEqual([])
  })

  it('与会话入口共享 cwd 缓存：projectCommands 探过后，同 cwd 会话取数命中缓存不重探', async () => {
    const { proj, sess, rt, probeCalls } = setup('claude')
    await rt.projectCommands(proj.id)          // 探一次，填 cwd='/work' 缓存
    await rt.supportedCommands(sess.id)        // 同 cwd → 命中缓存
    expect(probeCalls.length).toBe(1)
  })
})
