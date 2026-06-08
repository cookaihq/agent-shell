import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'node:events'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { CodexJsonRpcClient, type CodexJsonRpcOpts } from '../jsonRpc'

/** 假子进程：注入 stdout/stderr 分块、记录写入 stdin 的行与 kill 信号（对齐 scheduler.test 的 fakeChild）。 */
function fakeChild() {
  const cp: any = new EventEmitter()
  cp.stdout = new EventEmitter()
  cp.stderr = new EventEmitter()
  cp.stdinWrites = [] as string[]
  cp.stdinEnded = false
  cp.killed = false
  cp.stdin = {
    write: (s: string) => { cp.stdinWrites.push(s); return true },
    end: () => { cp.stdinEnded = true },
  }
  cp.killSignals = [] as string[]
  cp.kill = (sig?: string) => { cp.killed = true; cp.killSignals.push(sig || 'SIGTERM'); return true }
  return cp
}

/** 起一个 client + 暴露假子进程与 spawn 入参。 */
function makeClient(over: Partial<CodexJsonRpcOpts> = {}) {
  const cp = fakeChild()
  const notifications: Array<{ method: string; params: unknown }> = []
  const serverRequests: Array<{ method: string; id: number; params: unknown }> = []
  const exits: Array<{ code: number | null; err?: Error }> = []
  let captured: any
  const spawnFn = ((bin: string, args: string[], opts: any) => {
    captured = { bin, args, opts }
    return cp
  }) as any
  const client = new CodexJsonRpcClient({
    binPath: '/abs/codex',
    args: ['app-server'],
    cwd: '/work',
    env: { PATH: '/usr/bin' },
    spawnFn,
    onNotification: (method, params) => notifications.push({ method, params }),
    onServerRequest: (method, id, params) => serverRequests.push({ method, id, params }),
    onExit: (code, err) => exits.push({ code, err }),
    ...over,
  })
  return { client, cp, notifications, serverRequests, exits, getCaptured: () => captured }
}

/** 取出最后一次写入 stdin 的【完整 JSON 对象】（一行 = 一条 message）。 */
function lastWrite(cp: any): any {
  return JSON.parse(cp.stdinWrites.at(-1)!.trim())
}

describe('CodexJsonRpcClient', () => {
  it('spawn 入参：binPath + args + cwd + env，stdio 三管', () => {
    const { getCaptured } = makeClient()
    const c = getCaptured()
    expect(c.bin).toBe('/abs/codex')
    expect(c.args).toEqual(['app-server'])
    expect(c.opts.cwd).toBe('/work')
    expect(c.opts.env.PATH).toBe('/usr/bin')
    expect(c.opts.stdio).toEqual(['pipe', 'pipe', 'pipe'])
  })

  it('request → response：写出 {method,id,params} 行；匹配 {id,result} → resolve（跨两块分包验证行缓冲）', async () => {
    const { client, cp } = makeClient()
    const p = client.request('initialize', { clientInfo: { name: 'x' } })
    // 写出的是一行 JSON，含 method/id/params
    const sent = lastWrite(cp)
    expect(sent).toMatchObject({ method: 'initialize', params: { clientInfo: { name: 'x' } } })
    expect(typeof sent.id).toBe('number')
    expect(cp.stdinWrites.at(-1)!.endsWith('\n')).toBe(true)
    // response 拆成两块到达，证明 LineBuffer 拼行
    const line = JSON.stringify({ id: sent.id, result: { ok: true, userAgent: 'codex/0.137.0' } }) + '\n'
    cp.stdout.emit('data', line.slice(0, 8))
    cp.stdout.emit('data', line.slice(8))
    await expect(p).resolves.toEqual({ ok: true, userAgent: 'codex/0.137.0' })
  })

  it('request → error：匹配 {id,error} → reject（带 code/message）', async () => {
    const { client, cp } = makeClient()
    const p = client.request('thread/start', {})
    const id = lastWrite(cp).id
    cp.stdout.emit('data', JSON.stringify({ id, error: { code: -32600, message: 'missing field turnId' } }) + '\n')
    await expect(p).rejects.toMatchObject({ message: expect.stringContaining('missing field turnId') })
  })

  it('递增 id：连续两次 request 分配不同的递增 id', () => {
    const { client, cp } = makeClient()
    client.request('a')
    client.request('b')
    const id1 = JSON.parse(cp.stdinWrites.at(-2)!.trim()).id
    const id2 = JSON.parse(cp.stdinWrites.at(-1)!.trim()).id
    expect(id2).toBe(id1 + 1)
  })

  it('notification（无 id）→ onNotification，不被当成 response', () => {
    const { cp, notifications } = makeClient()
    cp.stdout.emit('data', JSON.stringify({ method: 'thread/started', params: { thread: { id: 't1' } } }) + '\n')
    expect(notifications).toEqual([{ method: 'thread/started', params: { thread: { id: 't1' } } }])
  })

  it('server→client request（method+id 同时有）→ onServerRequest；respond 写出 {id,result}', () => {
    const { client, cp, serverRequests, notifications } = makeClient()
    cp.stdout.emit('data', JSON.stringify({
      method: 'item/commandExecution/requestApproval', id: 99, params: { itemId: 'call_x' },
    }) + '\n')
    // 同时有 method 与 id → 是 server→client request，不是 notification、不是 response
    expect(serverRequests).toEqual([{ method: 'item/commandExecution/requestApproval', id: 99, params: { itemId: 'call_x' } }])
    expect(notifications).toEqual([])
    // 回执：{id, result}
    client.respond(99, { decision: 'accept' })
    expect(lastWrite(cp)).toEqual({ id: 99, result: { decision: 'accept' } })
    expect(cp.stdinWrites.at(-1)!.endsWith('\n')).toBe(true)
  })

  it('server→client request 的 id 与我方 request id 撞号也不混淆（按 method 字段判别，非按 id 查表）', () => {
    const { client, cp, serverRequests } = makeClient()
    client.request('initialize')   // 分配 id=1
    // server 发来一个 id=1 但【带 method】的 request（approval 真机 id 从 0 起，可能撞我方号）
    cp.stdout.emit('data', JSON.stringify({ method: 'item/fileChange/requestApproval', id: 1, params: {} }) + '\n')
    // 必须当成 server request 派发，绝不能拿去 resolve 我方 pending(id=1)
    expect(serverRequests).toEqual([{ method: 'item/fileChange/requestApproval', id: 1, params: {} }])
  })

  it('进程 close：所有 pending request 被 reject（不挂起）；onExit 触发', async () => {
    const { client, cp, exits } = makeClient()
    const p = client.request('initialize')
    cp.emit('close', 1, null)
    await expect(p).rejects.toThrow()
    expect(exits).toHaveLength(1)
    expect(exits[0].code).toBe(1)
  })

  it("spawn 'error'（ENOENT）：pending reject + onExit 带 err（不挂起）", async () => {
    const { client, cp, exits } = makeClient()
    const p = client.request('initialize')
    cp.emit('error', Object.assign(new Error('spawn /abs/codex ENOENT'), { code: 'ENOENT' }))
    await expect(p).rejects.toThrow(/ENOENT/)
    expect(exits[0].err?.message).toContain('ENOENT')
  })

  it("error 后又来 close：onExit 只触发一次（settled 守卫）", async () => {
    const { client, cp, exits } = makeClient()
    const p = client.request('initialize')
    cp.emit('error', new Error('ENOENT'))
    cp.emit('close', null, null)
    await expect(p).rejects.toThrow()
    expect(exits).toHaveLength(1)
  })

  it('close()：先 SIGTERM；宽限内未退 → SIGKILL；pending 全 reject', async () => {
    vi.useFakeTimers()
    const { client, cp } = makeClient()
    const p = client.request('initialize')
    client.close()
    expect(cp.killSignals).toEqual(['SIGTERM'])
    vi.advanceTimersByTime(5000)
    expect(cp.killSignals).toEqual(['SIGTERM', 'SIGKILL'])
    // SIGKILL 后 OS 触发 close → finalize 统一 reject 全部 pending
    cp.emit('close', null, 'SIGKILL')
    await expect(p).rejects.toThrow()
    vi.useRealTimers()
  })

  it('close()：进程在宽限内 close → 不再 SIGKILL（撤销 grace 计时器）', async () => {
    vi.useFakeTimers()
    const { client, cp } = makeClient()
    client.close()
    cp.emit('close', 0, null)
    vi.advanceTimersByTime(5000)
    expect(cp.killSignals).toEqual(['SIGTERM'])
    vi.useRealTimers()
  })

  it('坏行（JSON 解析失败 / 空行）→ 不崩，跳过；后续好行仍处理', () => {
    const { cp, notifications } = makeClient()
    cp.stdout.emit('data', '\n')                                   // 空行
    cp.stdout.emit('data', '{not json\n')                          // 坏 JSON
    cp.stdout.emit('data', JSON.stringify({ method: 'turn/started', params: { x: 1 } }) + '\n')
    expect(notifications).toEqual([{ method: 'turn/started', params: { x: 1 } }])
  })

  it('真实 fixture：喂 basic-conversation.jsonl 全部行，notification 正常派发、无抛错', () => {
    const path = fileURLToPath(new URL('../__fixtures__/basic-conversation.jsonl', import.meta.url))
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
    const { cp, notifications, serverRequests } = makeClient()
    expect(() => {
      for (const l of lines) cp.stdout.emit('data', l + '\n')
    }).not.toThrow()
    // basic 流里有 thread/started、turn/started 等通知
    expect(notifications.some((n) => n.method === 'thread/started')).toBe(true)
    expect(notifications.some((n) => n.method === 'turn/completed')).toBe(true)
    // basic 无审批 → 无 server request
    expect(serverRequests).toEqual([])
  })

  it('真实 fixture：approval.jsonl 含 item/commandExecution/requestApproval → 落到 onServerRequest', () => {
    const path = fileURLToPath(new URL('../__fixtures__/approval.jsonl', import.meta.url))
    const lines = readFileSync(path, 'utf8').split('\n').filter((l) => l.trim())
    const { cp, serverRequests } = makeClient()
    for (const l of lines) cp.stdout.emit('data', l + '\n')
    expect(serverRequests.some((r) => r.method === 'item/commandExecution/requestApproval')).toBe(true)
  })
})
