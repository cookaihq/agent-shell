import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../server'
import { openDatabase } from '../db/database'
import { SessionRuntime } from '../session/sessionRuntime'
import { getSession } from '../db/sessions'
import { readRecords } from '../session/transcript'
import { fakeCodexClient } from '../runtimes/codex/__tests__/fakeCodexClient'

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

const tick = () => new Promise((r) => setImmediate(r))

describe('M6 端到端会话生命周期', () => {
  it('建项目→建会话→submit→SSE→落库→续投→interrupt（codex app-server 全链路，mock client）', async () => {
    const db = openDatabase(':memory:')
    const codex = fakeCodexClient()
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-tr-'))
    const runtime = new SessionRuntime({ db, resolveBin: () => '/bin', codexClientFactory: codex.factory, transcriptDir: tdir })
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
    await tick()
    const c = codex.current()
    c.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    await fetch(U + `/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'q2' }) })  // 运行中入队
    // q1 一轮：agentMessage 定格 a1 → usage → turn/completed
    c.notify('item/completed', { item: { type: 'agentMessage', id: 'msg-1', text: 'a1' } })
    c.notify('thread/tokenUsage/updated', { tokenUsage: { total: { inputTokens: 2, outputTokens: 3 } } })
    c.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
    await tick()

    // 常驻保活：q2 在同一 app-server 续投（pushUser，不新起 client）；thread_id 落库为 resumable_id
    expect(codex.instances.length).toBe(1)
    expect(getSession(db, sid)).toMatchObject({ resumableId: 'th-1' })

    // 5. SSE 收到第一轮 message 事件（循环读跳过 ": connected" 握手帧）
    const decoder = new TextDecoder()
    let collected = ''
    while (!collected.includes('event: message')) {
      const { value, done } = await reader.read()
      if (done) break
      collected += decoder.decode(value)
    }
    expect(collected).toContain('event: message')

    // 6. interrupt 第二轮（q2 进行中）→ turn/interrupt + 关 client → 合成 aborted
    c.notify('turn/started', { turn: { id: 'turn-2', status: 'inProgress' } })
    await fetch(U + `/sessions/${sid}/interrupt`, { method: 'POST' })
    await tick()
    expect(getSession(db, sid)).toMatchObject({ status: 'aborted' })

    // 7. 历史落盘验证：q1(user) → q2(user，入队) → a1(codex assistant) → q2 轮中止的 run_note 留痕，按记录类型核对
    //    第 4 条 assistant_blocks = 第二轮（q2）被 interrupt 时落的「已中止」run_note 块：中止是历史事实，
    //    随历史落库 → 重载留痕 + 继续入口（旧设计底部条不落库，重载即丢；此处端到端守护新行为）。
    const recs = readRecords(tdir, sid)
    expect(recs.map((r) => r.type)).toEqual(['user_prompt', 'user_prompt', 'assistant_blocks', 'assistant_blocks'])
    expect((recs.at(-1)!.raw as { blocks?: unknown[] }).blocks).toEqual([{ type: 'run_note', stopReason: 'aborted' }])

    ac.abort()
    await reader.cancel().catch(() => {})
  })

  it('codex resume：冷会话（带存档 resumable_id，如 daemon 重启后）submit → 走 thread/resume 续接同 thread', async () => {
    // 首段 runtime：跑一轮拿到 thread_id 并落库（resumableId='th-1'），然后 server 退出（client close）模拟会话冷掉。
    const db = openDatabase(':memory:')
    const codex1 = fakeCodexClient()
    const runtime = new SessionRuntime({ db, resolveBin: () => '/bin', codexClientFactory: codex1.factory })
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-e2e-'))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db, runtime, projectsDir: tmp })
    const U = server.url
    const proj = await (await fetch(U + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'R' }) })).json() as { projectId: string }
    const sess = await (await fetch(U + '/sessions', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ projectId: proj.projectId, engine: 'codex', model: 'gpt-5' }) })).json() as { sessionId: string }
    const sid = sess.sessionId

    // 首轮：submit → 起 server（thread/start，无 resume）→ turn/completed
    await fetch(U + `/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'q1' }) })
    await tick()
    const c1 = codex1.current()
    expect(c1.requests.map((r) => r.method)).toEqual(['initialize', 'thread/start', 'turn/start'])   // 首轮无 resume
    c1.notify('turn/started', { turn: { id: 'turn-1', status: 'inProgress' } })
    c1.notify('turn/completed', { turn: { id: 'turn-1', status: 'completed' } })
    await tick()
    expect(getSession(db, sid)).toMatchObject({ status: 'completed', resumableId: 'th-1' })
    // 模拟会话冷掉：底层 server 退出（client close → onExit → onDone 清 serverAlive）
    c1.client.close()
    await tick()

    // 冷态再 submit：serverAlive 已 false → startTurn 用存档的 resumable_id 起新 server，走 thread/resume 续接 'th-1'
    await fetch(U + `/sessions/${sid}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'q2' }) })
    await tick()
    expect(codex1.instances.length).toBe(2)
    const c2 = codex1.current()
    expect(c2.requests.map((r) => r.method)).toEqual(['initialize', 'thread/resume', 'turn/start'])
    expect((c2.requests[1].params as { threadId?: string }).threadId).toBe('th-1')
  })
})
