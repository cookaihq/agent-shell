import { describe, it, expect, afterEach } from 'vitest'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../server'
import { openDatabase } from '../db/database'
import { SessionRuntime } from '../session/sessionRuntime'
import { getSession } from '../db/sessions'
import { readRecords } from '../session/transcript'

let server: DaemonServer | null = null
let tmp = ''
afterEach(async () => {
  if (server) {
    // server.close() 等 Node http.Server 关闭，长连接（SSE）需要先在测试里 abort/cancel。
    // 为防止 SSE 连接未断时 close() 永久挂起，设 15s 超时兜底。
    await Promise.race([
      server.close(),
      new Promise<void>((_, reject) => setTimeout(() => reject(new Error('server.close() timeout')), 15000)),
    ])
    server = null
  }
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
}, 20000)

function fakeChild() {
  const cp: any = new EventEmitter()
  cp.stdout = new EventEmitter(); cp.stderr = new EventEmitter()
  cp.stdinWrites = []; cp.stdinEnded = false
  cp.stdin = { write: (s: string) => { cp.stdinWrites.push(s); return true }, end: () => { cp.stdinEnded = true } }
  cp.kill = () => true
  return cp
}
const tick = () => new Promise((r) => setImmediate(r))

describe('M6 端到端会话生命周期', () => {
  it('建项目→建会话→submit→SSE→落库→续投→interrupt（codex 全链路，mock 引擎）', async () => {
    const db = openDatabase(':memory:')
    const children: any[] = []
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-tr-'))
    const runtime = new SessionRuntime({ db, resolveBin: () => '/bin', spawnFn: (() => { const c = fakeChild(); children.push(c); return c }) as any, transcriptDir: tdir })
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-e2e-'))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db, runtime, projectsDir: tmp })
    const U = server.url

    // 1. 建项目
    const proj = await (await fetch(U + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'E2E' }) })).json() as { projectId: string }
    // 2. 建会话
    const sess = await (await fetch(U + '/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: proj.projectId, engine: 'codex', model: 'gpt-5' }) })).json() as { sessionId: string }
    const sid = sess.sessionId

    // 3. attach SSE
    const ac = new AbortController()
    const sse = await fetch(U + `/sessions/${sid}/stream`, { signal: ac.signal })
    const reader = sse.body!.getReader()

    // 4. submit 第一条 + 运行中续投第二条
    await fetch(U + `/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'q1' }) })
    await fetch(U + `/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'q2' }) })  // 入队
    const cp1 = children[0]
    cp1.stdout.emit('data', JSON.stringify({ type: 'thread.started', thread_id: 'th-e2e' }) + '\n')
    cp1.stdout.emit('data', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'a1' } }) + '\n')
    cp1.stdout.emit('data', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 2, output_tokens: 3 } }) + '\n')
    cp1.emit('close', 0, null)
    await tick()

    // 续投起了第二个进程，resumable_id 落库
    expect(children.length).toBe(2)
    expect(getSession(db, sid)).toMatchObject({ resumableId: 'th-e2e' })

    // 5. SSE 收到第一轮 message 事件（循环读跳过 ": connected" 握手帧）
    const decoder = new TextDecoder()
    let collected = ''
    while (!collected.includes('event: message')) {
      const { value, done } = await reader.read()
      if (done) break
      collected += decoder.decode(value)
    }
    expect(collected).toContain('event: message')

    // 6. interrupt 第二轮
    await fetch(U + `/sessions/${sid}/interrupt`, { method: 'POST' })
    children[1].emit('close', null, 'SIGTERM')
    await tick()
    expect(getSession(db, sid)).toMatchObject({ status: 'aborted' })

    // 7. 历史落盘验证：q1(user) → q2(user，入队) → a1(codex assistant)，按记录类型核对
    const types = readRecords(tdir, sid).map((r) => r.type)
    expect(types).toEqual(['user_prompt', 'user_prompt', 'assistant_blocks'])

    ac.abort()
    await reader.cancel().catch(() => {})
  })

  it('codex resume：首轮终结后再 submit → 第二进程 argv 含 resume <thread_id>', async () => {
    const db = openDatabase(':memory:')
    const calls: string[][] = []
    const children: any[] = []
    const runtime = new SessionRuntime({ db, resolveBin: () => '/bin', spawnFn: ((_bin: string, args: string[]) => { calls.push(args); const c = fakeChild(); children.push(c); return c }) as any })
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-e2e-'))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db, runtime, projectsDir: tmp })
    const U = server.url
    const proj = await (await fetch(U + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'R' }) })).json() as { projectId: string }
    const sess = await (await fetch(U + '/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: proj.projectId, engine: 'codex', model: 'gpt-5' }) })).json() as { sessionId: string }
    const sid = sess.sessionId

    // 首轮：submit → thread.started(th-r) → turn.completed → close（会话终结、归 idle）
    await fetch(U + `/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'q1' }) })
    expect(calls[0]).not.toContain('resume')                  // 首轮无 resume
    children[0].stdout.emit('data', JSON.stringify({ type: 'thread.started', thread_id: 'th-r' }) + '\n')
    children[0].stdout.emit('data', JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 1, output_tokens: 1 } }) + '\n')
    children[0].emit('close', 0, null)
    await tick()
    expect(getSession(db, sid)).toMatchObject({ status: 'completed', resumableId: 'th-r' })

    // 第二条：会话已 idle，submit → 用 resumable_id 起 resume 进程
    await fetch(U + `/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'q2' }) })
    expect(calls).toHaveLength(2)
    expect(calls[1]).toContain('resume')
    expect(calls[1]).toContain('th-r')
  })
})
