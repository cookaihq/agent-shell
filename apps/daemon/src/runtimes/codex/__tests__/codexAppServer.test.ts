import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { AgentEvent } from '@agent-shell/contracts'
import { runCodexAppServerTurn, type CodexAppServerTurnOpts, type CodexClientFactoryOpts, type CodexClientLike } from '../codexAppServer'

/**
 * 假 client：实现 CodexClientLike（request/respond/close），并把构造时拿到的回调暴露出来，
 * 让测试能脚本化地「喂 response / 喂 notification / 喂 server request / 触发 exit」。
 * request 默认返回的 response 由 responder 决定（按 method 给假结果），无匹配则 resolve {}。
 */
function makeFakeClient() {
  let cbs!: CodexClientFactoryOpts
  const requests: Array<{ method: string; params: unknown; id: number }> = []
  const responds: Array<{ id: number; result: unknown }> = []
  const closes: number[] = []
  let reqId = 0
  // 按 method 配置 response（thread/start 给 thread.id，其余 {}）。
  const responder = new Map<string, unknown>([
    ['initialize', { userAgent: 'agent-shell-probe/0.137.0 (Mac OS) unknown' }],
    ['thread/start', { thread: { id: 'thr-1' } }],
    ['thread/resume', { thread: { id: 'thr-resumed' } }],
    ['turn/start', { turn: { id: 'turn-resp-1' } }],
    ['turn/interrupt', {}],
  ])
  const client: CodexClientLike = {
    request: <T>(method: string, params?: unknown): Promise<T> => {
      const id = ++reqId
      requests.push({ method, params, id })
      const r = responder.has(method) ? responder.get(method) : {}
      return Promise.resolve(r as T)
    },
    respond: (id: number, result: unknown) => { responds.push({ id, result }) },
    close: (graceMs?: number) => { closes.push(graceMs ?? -1) },
  }
  const factory = (o: CodexClientFactoryOpts): CodexClientLike => { cbs = o; return client }
  return {
    factory,
    requests, responds, closes, responder,
    notify: (method: string, params: unknown) => cbs.onNotification(method, params),
    serverRequest: (method: string, id: number, params: unknown) => cbs.onServerRequest(method, id, params),
    exit: (code: number | null, err?: Error) => cbs.onExit?.(code, err),
    getCbs: () => cbs,
  }
}

function baseOpts(over: Partial<CodexAppServerTurnOpts> = {}): CodexAppServerTurnOpts {
  return {
    cwd: '/work', model: 'gpt-5.5', prompt: 'hi',
    binPath: '/abs/codex', baseEnv: { PATH: '/usr/bin' },
    onEvent: () => {},
    ...over,
  }
}

/** 等微任务队列排空（boot 的 await 链跑完）。 */
const flush = () => new Promise((r) => setTimeout(r, 0))

describe('runCodexAppServerTurn — 生命周期', () => {
  it('boot：initialize → thread/start → turn/start，threadId 经 onResumableId 抛一次', async () => {
    const fake = makeFakeClient()
    const resumable: string[] = []
    runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, onResumableId: (id) => resumable.push(id) }))
    await flush()
    expect(fake.requests.map((r) => r.method)).toEqual(['initialize', 'thread/start', 'turn/start'])
    // thread/start 参数：cwd/model 透传
    expect(fake.requests[1].params).toMatchObject({ cwd: '/work', model: 'gpt-5.5' })
    // turn/start 参数：threadId + text 块
    expect(fake.requests[2].params).toMatchObject({ threadId: 'thr-1', input: [{ type: 'text', text: 'hi', text_elements: [] }] })
    // threadId = resume 指针，只抛一次
    expect(resumable).toEqual(['thr-1'])
  })

  it('resumableId → 走 thread/resume（不 thread/start），threadId 取 resume 结果', async () => {
    const fake = makeFakeClient()
    const resumable: string[] = []
    runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, resumableId: 'prev-thread', onResumableId: (id) => resumable.push(id) }))
    await flush()
    expect(fake.requests.map((r) => r.method)).toEqual(['initialize', 'thread/resume', 'turn/start'])
    expect(fake.requests[1].params).toEqual({ threadId: 'prev-thread' })
    expect(resumable).toEqual(['thr-resumed'])
  })

  it('thread/start 透传 approval/sandbox/effort（identity）', async () => {
    const fake = makeFakeClient()
    runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, approval: 'on-request', sandbox: 'read-only', effort: 'high' }))
    await flush()
    expect(fake.requests[1].params).toEqual({ cwd: '/work', model: 'gpt-5.5', approvalPolicy: 'on-request', sandbox: 'read-only' })
    expect(fake.requests[2].params).toMatchObject({ effort: 'high' })
  })

  it('pathDir（自带版 codex-path，含 rg）prepend 到 spawn env.PATH（P6）', () => {
    const fake = makeFakeClient()
    runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, pathDir: '/bundle/codex-path' }))
    // codex-path 排在原 PATH 之前，codex 文件搜索才能找到随包 rg
    expect(fake.getCbs().env.PATH).toBe('/bundle/codex-path:/usr/bin')
  })

  it('省略 pathDir → PATH 不变（测试/无自带版兜底）', () => {
    const fake = makeFakeClient()
    runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory }))
    expect(fake.getCbs().env.PATH).toBe('/usr/bin')
  })
})

describe('runCodexAppServerTurn — 事件流映射', () => {
  it('喂真实 basic fixture 的 notification 子集 → 正确 AgentEvent 序列 + 流式累计 + done resolve', async () => {
    const fake = makeFakeClient()
    const events: AgentEvent[] = []
    const turnEnds: string[] = []
    const handle = runCodexAppServerTurn(baseOpts({
      clientFactory: fake.factory,
      onEvent: (e) => events.push(e),
      onTurnEnd: (s) => turnEnds.push(s),
    }))
    await flush()

    // turn/started → 记 turnId
    fake.notify('turn/started', { threadId: 'thr-1', turn: { id: 'turn-1', status: 'inProgress' } })

    // commandExecution started/completed → tool_use(bash) + tool_result
    fake.notify('item/started', { item: { type: 'commandExecution', id: 'call_1', command: 'ls' } })
    fake.notify('item/completed', { item: { type: 'commandExecution', id: 'call_1', exitCode: 0, aggregatedOutput: 'out' } })

    // agentMessage 流式：两条 delta 累计 → streaming message（累计全文）
    fake.notify('item/agentMessage/delta', { itemId: 'msg_1', delta: '你好' })
    fake.notify('item/agentMessage/delta', { itemId: 'msg_1', delta: '世界' })
    // 定格：item/completed(agentMessage) → eventMap emit 非流式 message
    fake.notify('item/completed', { item: { type: 'agentMessage', id: 'msg_1', text: '你好世界' } })

    // usage
    fake.notify('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 100, outputTokens: 10 }, modelContextWindow: 258400 } })

    // turn/completed → turn_end(completed)，但 client 保活（不退）
    fake.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })

    expect(events).toEqual([
      { type: 'tool_use', id: 'call_1', name: 'shell', input: { command: 'ls' }, tool: 'bash' },
      { type: 'tool_result', toolUseId: 'call_1', ok: true, content: 'out' },
      { type: 'message', text: '你好', streaming: true },
      { type: 'message', text: '你好世界', streaming: true },
      { type: 'message', text: '你好世界' },   // 定格（streaming 缺省），来自 eventMap
      { type: 'usage', inputTokens: 100, outputTokens: 10, contextTokens: 100, contextWindow: 258400, contextWindowIsAuthoritative: true },
      { type: 'turn_end', stopReason: 'completed' },
    ])
    expect(turnEnds).toEqual(['completed'])

    // turn 完成但 client 保活：done 未 resolve。endInput 才优雅关闭 → onExit → done resolve。
    let resolved = false
    void handle.done.then(() => { resolved = true })
    await flush()
    expect(resolved).toBe(false)
    handle.endInput()
    fake.exit(0)
    await flush()
    expect(resolved).toBe(true)
    expect(fake.closes.length).toBeGreaterThan(0)
  })

  it('流式 message 文本是累计全文（reducer 替换语义），不是单帧增量', async () => {
    const fake = makeFakeClient()
    const msgs: string[] = []
    runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, onEvent: (e) => { if (e.type === 'message' && e.streaming) msgs.push(e.text) } }))
    await flush()
    fake.notify('turn/started', { turn: { id: 't', status: 'inProgress' } })
    fake.notify('item/agentMessage/delta', { itemId: 'm', delta: 'a' })
    fake.notify('item/agentMessage/delta', { itemId: 'm', delta: 'b' })
    fake.notify('item/agentMessage/delta', { itemId: 'm', delta: 'c' })
    expect(msgs).toEqual(['a', 'ab', 'abc'])
  })
})

describe('runCodexAppServerTurn — interrupt', () => {
  it('interrupt 发 turn/interrupt {threadId, turnId}（带当前 turnId）+ 关闭 client', async () => {
    const fake = makeFakeClient()
    const handle = runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory }))
    await flush()
    fake.notify('turn/started', { threadId: 'thr-1', turn: { id: 'turn-7', status: 'inProgress' } })
    handle.interrupt()
    const interruptReq = fake.requests.find((r) => r.method === 'turn/interrupt')
    expect(interruptReq?.params).toEqual({ threadId: 'thr-1', turnId: 'turn-7' })
    expect(fake.closes.length).toBeGreaterThan(0)
  })

  it('interrupt 后上游 turn/completed.status=interrupted → turn_end(interrupted)', async () => {
    const fake = makeFakeClient()
    const turnEnds: string[] = []
    const handle = runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, onTurnEnd: (s) => turnEnds.push(s) }))
    await flush()
    fake.notify('turn/started', { turn: { id: 'turn-7', status: 'inProgress' } })
    handle.interrupt()
    fake.notify('turn/completed', { turn: { id: 'turn-7', status: 'interrupted' } })
    expect(turnEnds).toEqual(['interrupted'])
  })
})

describe('runCodexAppServerTurn — pushUser 多轮续投', () => {
  it('pushUser：同 thread 新起 turn/start，重置 turnId 与流式累计', async () => {
    const fake = makeFakeClient()
    const events: AgentEvent[] = []
    const handle = runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, onEvent: (e) => events.push(e) }))
    await flush()
    fake.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    fake.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })

    handle.pushUser('second')
    await flush()
    const turnStarts = fake.requests.filter((r) => r.method === 'turn/start')
    expect(turnStarts).toHaveLength(2)
    expect(turnStarts[1].params).toMatchObject({ threadId: 'thr-1', input: [{ type: 'text', text: 'second', text_elements: [] }] })

    // 新轮的 turn/started 重填 turnId → interrupt 用新 turnId
    fake.notify('turn/started', { threadId: 'thr-1', turn: { id: 'turn-2', status: 'inProgress' } })
    handle.interrupt()
    const interruptReq = fake.requests.find((r) => r.method === 'turn/interrupt')
    expect(interruptReq?.params).toEqual({ threadId: 'thr-1', turnId: 'turn-2' })
  })
})

describe('runCodexAppServerTurn — 终结兜底', () => {
  it('turn 进行中 client 异常退出（无 turn_end）→ 合成 failed turn_end + done resolve', async () => {
    const fake = makeFakeClient()
    const turnEnds: string[] = []
    const events: AgentEvent[] = []
    const handle = runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, onEvent: (e) => events.push(e), onTurnEnd: (s) => turnEnds.push(s) }))
    await flush()
    fake.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })

    let resolved = false
    void handle.done.then(() => { resolved = true })
    fake.exit(1, new Error('boom'))
    await flush()
    expect(turnEnds).toEqual(['failed'])
    expect(events.find((e) => e.type === 'turn_end')).toMatchObject({ type: 'turn_end', stopReason: 'failed', detail: 'boom' })
    expect(resolved).toBe(true)
  })

  it('正常 turn/completed 后退出：onExit 不再二次合成 turn_end', async () => {
    const fake = makeFakeClient()
    const turnEnds: string[] = []
    const handle = runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, onTurnEnd: (s) => turnEnds.push(s) }))
    await flush()
    fake.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    fake.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
    handle.endInput()
    fake.exit(0)
    await flush()
    expect(turnEnds).toEqual(['completed'])   // 仅一次，无二次 failed
  })

  it('boot 失败（initialize reject）→ 合成 failed + done resolve', async () => {
    const fake = makeFakeClient()
    // 让 initialize reject
    const orig = fake.getCbs
    const turnEnds: string[] = []
    // 替换 responder：用一个会 reject 的 client。改 factory 包装。
    const rejectingFactory = (o: CodexClientFactoryOpts): CodexClientLike => {
      const base = fake.factory(o)
      return {
        ...base,
        request: <T>(method: string): Promise<T> => method === 'initialize' ? Promise.reject(new Error('init failed')) : Promise.resolve({} as T),
      }
    }
    void orig
    let resolved = false
    const handle = runCodexAppServerTurn(baseOpts({ clientFactory: rejectingFactory, onTurnEnd: (s) => turnEnds.push(s) }))
    void handle.done.then(() => { resolved = true })
    await flush()
    expect(turnEnds).toEqual(['failed'])
    expect(resolved).toBe(true)
  })

  it('idle 看门狗：turn 进行中超时无通知 → 合成 failed + 关闭', async () => {
    vi.useFakeTimers()
    const fake = makeFakeClient()
    const turnEnds: string[] = []
    runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, idleTimeoutMs: 1000, onTurnEnd: (s) => turnEnds.push(s) }))
    await vi.advanceTimersByTimeAsync(0)   // 让 boot 微任务跑完
    fake.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    await vi.advanceTimersByTimeAsync(1000)
    expect(turnEnds).toEqual(['failed'])
    expect(fake.closes.length).toBeGreaterThan(0)
    vi.useRealTimers()
  })
})

describe('runCodexAppServerTurn — 逐工具审批回路（Phase 4）', () => {
  /** 从 approval.jsonl 取出那条真实的 item/commandExecution/requestApproval（server→client request）。 */
  function realCommandApproval(): { id: number; params: any } {
    const path = fileURLToPath(new URL('../__fixtures__/approval.jsonl', import.meta.url))
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
    for (const l of lines) {
      const msg = JSON.parse(l)
      if (msg.method === 'item/commandExecution/requestApproval' && msg.id !== undefined) {
        return { id: msg.id, params: msg.params }
      }
    }
    throw new Error('approval.jsonl 缺 item/commandExecution/requestApproval')
  }

  it('真实 fixture command 审批 → emit permission_request（shell/{command,cwd}/reason）', async () => {
    const { id, params } = realCommandApproval()
    const fake = makeFakeClient()
    const events: AgentEvent[] = []
    runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, onEvent: (e) => events.push(e) }))
    await flush()
    fake.serverRequest('item/commandExecution/requestApproval', id, params)

    const ev = events.find((e) => e.type === 'permission_request') as any
    expect(ev).toBeDefined()
    // requestId = params.itemId（renderer POST 回来用它对账）
    expect(ev.requestId).toBe(params.itemId)
    expect(ev.toolName).toBe('shell')
    expect(ev.input).toEqual({ command: params.command, cwd: params.cwd })
    expect(ev.description).toBe(params.reason)
  })

  it('resolveDecision allow → respond(jsonRpcId, {decision:"accept"})', async () => {
    const { id, params } = realCommandApproval()
    const fake = makeFakeClient()
    const handle = runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory }))
    await flush()
    fake.serverRequest('item/commandExecution/requestApproval', id, params)
    handle.resolveDecision(params.itemId, { behavior: 'allow' })
    expect(fake.responds).toEqual([{ id, result: { decision: 'accept' } }])
  })

  it('resolveDecision deny → cancel（fixture availableDecisions 无 decline）', async () => {
    const { id, params } = realCommandApproval()
    // 实测 availableDecisions = ["accept", {acceptWithExecpolicyAmendment}, "cancel"]，无 decline
    expect(params.availableDecisions).not.toContain('decline')
    const fake = makeFakeClient()
    const handle = runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory }))
    await flush()
    fake.serverRequest('item/commandExecution/requestApproval', id, params)
    handle.resolveDecision(params.itemId, { behavior: 'deny' })
    expect(fake.responds).toEqual([{ id, result: { decision: 'cancel' } }])
  })

  it('resolveDecision deny → decline（当 availableDecisions 含 decline，如 fileChange）', async () => {
    const fake = makeFakeClient()
    const events: AgentEvent[] = []
    const handle = runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, onEvent: (e) => events.push(e) }))
    await flush()
    // 合成一条 fileChange 审批：决策枚举含 decline
    fake.serverRequest('item/fileChange/requestApproval', 9, {
      threadId: 'thr-1', turnId: 'turn-1', itemId: 'call_fc', startedAtMs: 1,
      reason: '是否允许写入文件？', grantRoot: false,
      availableDecisions: ['accept', 'acceptForSession', 'decline', 'cancel'],
    })
    const ev = events.find((e) => e.type === 'permission_request') as any
    expect(ev).toBeDefined()
    expect(ev.requestId).toBe('call_fc')
    expect(ev.toolName).toBe('apply_patch')
    expect(ev.description).toBe('是否允许写入文件？')

    handle.resolveDecision('call_fc', { behavior: 'deny' })
    expect(fake.responds).toEqual([{ id: 9, result: { decision: 'decline' } }])
  })

  it('resolveDecision 未知/过期 requestId → 不抛、不 respond', async () => {
    const fake = makeFakeClient()
    const handle = runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory }))
    await flush()
    expect(() => handle.resolveDecision('nonexistent', { behavior: 'allow' })).not.toThrow()
    expect(fake.responds).toEqual([])
  })

  it('resolveDecision 后清理：同一 requestId 二次回执无效（不重复 respond）', async () => {
    const { id, params } = realCommandApproval()
    const fake = makeFakeClient()
    const handle = runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory }))
    await flush()
    fake.serverRequest('item/commandExecution/requestApproval', id, params)
    handle.resolveDecision(params.itemId, { behavior: 'allow' })
    handle.resolveDecision(params.itemId, { behavior: 'deny' })   // 已清理 → 静默忽略
    expect(fake.responds).toEqual([{ id, result: { decision: 'accept' } }])
  })

  it('真实 fixture：approval.jsonl 全量喂入不崩', async () => {
    const path = fileURLToPath(new URL('../__fixtures__/approval.jsonl', import.meta.url))
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
    const fake = makeFakeClient()
    runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory }))
    await flush()
    expect(() => {
      for (const l of lines) {
        const msg = JSON.parse(l)
        if (typeof msg.method === 'string' && msg.id !== undefined && msg.id !== null) fake.serverRequest(msg.method, msg.id, msg.params)
        else if (typeof msg.method === 'string') fake.notify(msg.method, msg.params)
      }
    }).not.toThrow()
  })
})

// ── Phase 5a：subagent 多 thread 路由（真实 subagent.jsonl 驱动）──────────────────
const MAIN_TID = '019ea056-bb26-7161-8549-ea166beb5ac2'
const SUB_A = '019ea057-3083-78d3-913d-9389a35cbd6c'   // file-writer-A（先 spawn）
const SUB_B = '019ea057-30c4-7da3-98dd-b23091509ef5'   // file-writer-B（后 spawn）

/** 读 subagent.jsonl，把它的 notification（无 id）按序喂进 driver。main thread 对齐 fixture 的真实 threadId。 */
async function driveSubagentFixture() {
  const path = fileURLToPath(new URL('../__fixtures__/subagent.jsonl', import.meta.url))
  const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
  const fake = makeFakeClient()
  // 关键：让 driver 的主 threadId = fixture 的真实主 thread，子线程归属才能正确判别。
  fake.responder.set('thread/start', { thread: { id: MAIN_TID } })
  const events: AgentEvent[] = []
  const turnEnds: string[] = []
  const handle = runCodexAppServerTurn(baseOpts({ clientFactory: fake.factory, onEvent: (e) => events.push(e), onTurnEnd: (s) => turnEnds.push(s) }))
  await flush()
  for (const l of lines) {
    const msg = JSON.parse(l)
    // subagent.jsonl 全是 notification（无 server→client request）。
    if (typeof msg.method === 'string') fake.notify(msg.method, msg.params)
  }
  return { events, turnEnds, handle, fake }
}

describe('runCodexAppServerTurn — subagent 多 thread 路由（Phase 5a）', () => {
  type Sub = Extract<AgentEvent, { type: 'codex_subagent' }>
  const subsOf = (events: AgentEvent[]): Sub[] => events.filter((e): e is Sub => e.type === 'codex_subagent')

  it('回归护栏：主线内容仍走共享事件（message/tool_use/...），且不混入任何 codex_subagent', async () => {
    const { events } = await driveSubagentFixture()
    // 主线产出的共享事件里，归属 thread 不可能是子线程——这些事件本就不带 threadId，断言它们确实是「主线该有的」类型。
    const sharedTypes = new Set(['message', 'tool_use', 'tool_result', 'usage', 'turn_start', 'turn_end'])
    const shared = events.filter((e) => sharedTypes.has(e.type))
    // 主线至少发出过 message（主代理自己有 agentMessage）。
    expect(shared.some((e) => e.type === 'message')).toBe(true)
    // 主代理自己的 commandExecution（od/printf 核验命令）→ 共享 tool_use(shell/bash)。
    expect(shared.some((e) => e.type === 'tool_use' && (e as any).name === 'shell')).toBe(true)
    // 共享事件一律不带 threadId（主线事件无 thread 标签，spec §4.2）。
    expect(shared.every((e) => !('threadId' in (e as any)))).toBe(true)
  })

  it('回归护栏：fixture 无主 turn/completed → 不产任何 turn_end（子线程 turn/completed 不得泄漏成主 turn_end）', async () => {
    const { events, turnEnds } = await driveSubagentFixture()
    // subagent.jsonl 只含两条「子线程」turn/completed，主线 turn/completed 未被抓到 → 主 turn_end 必须为 0。
    expect(turnEnds).toEqual([])
    expect(events.filter((e) => e.type === 'turn_end')).toEqual([])
  })

  it('spawnAgent → codex_subagent{phase:spawned} 带真实 sub threadId + parentThreadId(主) + task(prompt 全文)', async () => {
    const { events } = await driveSubagentFixture()
    const spawned = subsOf(events).filter((e) => e.phase === 'spawned')
    expect(spawned.map((e) => e.threadId).sort()).toEqual([SUB_A, SUB_B].sort())
    for (const e of spawned) {
      expect(e.parentThreadId).toBe(MAIN_TID)
      expect(typeof e.task).toBe('string')
    }
    const a = spawned.find((e) => e.threadId === SUB_A)!
    expect(a.task).toContain('角色：file-writer-A')
    const b = spawned.find((e) => e.threadId === SUB_B)!
    expect(b.task).toContain('角色：file-writer-B')
  })

  it('形态A 锚点：spawnAgent 还 emit 一个主线 tool_use 块（name spawnAgent，input.parentThreadId=主），每个父 thread 只一次', async () => {
    const { events } = await driveSubagentFixture()
    // 主线 tool_use 锚点块：name='spawnAgent'，无 threadId（主线事件无 thread 标签，回归护栏要求）。
    const anchors = events.filter((e): e is Extract<AgentEvent, { type: 'tool_use' }> => e.type === 'tool_use' && (e as any).name === 'spawnAgent')
    // 两个 spawnAgent item 同属主 thread → 去重后只产一个锚点块（一个 cxp-group 容纳全部并发子代理，对齐原型）。
    expect(anchors).toHaveLength(1)
    const anchor = anchors[0]
    expect((anchor.input as any).parentThreadId).toBe(MAIN_TID)
    // 锚点是主线 tool_use：绝不带 threadId 顶层标签（否则会被子线程路由误判 / 污染对账）。
    expect('threadId' in (anchor as any)).toBe(false)
    // 锚点 id 稳定且与父 thread 绑定（renderer timelineMount 据此找该父下所有子代理）。
    expect(anchor.id).toContain(MAIN_TID)
  })

  it('子线程 item → codex_subagent{phase:item} 归到正确子 thread（message/thinking/tool_use/tool_result）', async () => {
    const { events } = await driveSubagentFixture()
    const items = subsOf(events).filter((e) => e.phase === 'item')
    // 两个子线程都各有自己的 item 流，互不串。
    const aItems = items.filter((e) => e.threadId === SUB_A)
    const bItems = items.filter((e) => e.threadId === SUB_B)
    expect(aItems.length).toBeGreaterThan(0)
    expect(bItems.length).toBeGreaterThan(0)
    // 子 A 有定格 message（item/completed agentMessage）含其汇报正文。
    const aFinalMsgs = aItems.filter((e) => e.item?.kind === 'message' && !(e.item as any).streaming)
    expect(aFinalMsgs.some((e) => (e.item as any).text.includes('AAA.txt'))).toBe(true)
    // 子线程有 commandExecution → tool_use(shell/bash) + tool_result。
    expect(aItems.some((e) => e.item?.kind === 'tool_use')).toBe(true)
    expect(aItems.some((e) => e.item?.kind === 'tool_result')).toBe(true)
    // 流式 message：accumulate per-itemId（streaming:true 的累计帧存在）。
    expect(items.some((e) => e.item?.kind === 'message' && (e.item as any).streaming === true)).toBe(true)
  })

  it('wait 完成 → 每个完成子代理 emit codex_subagent{phase:report} 带 agentsStates[tid].message', async () => {
    const { events } = await driveSubagentFixture()
    const reports = subsOf(events).filter((e) => e.phase === 'report')
    const a = reports.find((e) => e.threadId === SUB_A)
    const b = reports.find((e) => e.threadId === SUB_B)
    expect(a?.report).toContain('AAA.txt')
    expect(b?.report).toContain('BBB.txt')
  })

  it('wait 编排态 → codex_subagent{phase:wait} started→waiting:true / completed→waiting:false（归属主 thread）', async () => {
    const { events } = await driveSubagentFixture()
    const waits = subsOf(events).filter((e) => e.phase === 'wait')
    expect(waits.length).toBeGreaterThan(0)
    expect(waits.every((e) => e.threadId === MAIN_TID && e.parentThreadId === MAIN_TID)).toBe(true)
    expect(waits.some((e) => e.waiting === true)).toBe(true)
    expect(waits.some((e) => e.waiting === false)).toBe(true)
  })

  it('closeAgent → codex_subagent{phase:closed} 带子 threadId', async () => {
    const { events } = await driveSubagentFixture()
    const closed = subsOf(events).filter((e) => e.phase === 'closed')
    expect(closed.map((e) => e.threadId).sort()).toEqual([SUB_A, SUB_B].sort())
  })

  it('agentsStates 状态变更 → codex_subagent{phase:status}（去重；pendingInit/completed 至少各一次）', async () => {
    const { events } = await driveSubagentFixture()
    const status = subsOf(events).filter((e) => e.phase === 'status')
    expect(status.some((e) => e.status === 'pendingInit')).toBe(true)
    expect(status.some((e) => e.status === 'completed')).toBe(true)
    // 去重：同一 (threadId,status) 不重复发——按 (tid|status) 计数应无重复。
    const seen = new Set<string>()
    for (const e of status) {
      const key = `${e.threadId}|${e.status}`
      expect(seen.has(key)).toBe(false)
      seen.add(key)
    }
  })

  it('3 个 threadId → 1 主流 + 2 子流正确分离', async () => {
    const { events } = await driveSubagentFixture()
    const subItemThreads = new Set(subsOf(events).filter((e) => e.phase === 'item').map((e) => e.threadId))
    // 子 item 只来自两个子 thread，绝不来自主 thread。
    expect(subItemThreads).toEqual(new Set([SUB_A, SUB_B]))
    expect(subItemThreads.has(MAIN_TID)).toBe(false)
  })

  it('全量喂入不崩（含 turn/diff/updated、account/rateLimits/updated 等未知通知防御）', async () => {
    await expect(driveSubagentFixture()).resolves.toBeDefined()
  })
})
