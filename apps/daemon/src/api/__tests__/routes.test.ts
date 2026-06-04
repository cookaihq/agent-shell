import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'
import { createProject, listProjects } from '../../db/projects'
import { createSession } from '../../db/sessions'
import { appendMessage, getMessages as getMsgs } from '../../db/messages'
import { recordUsage } from '../../db/usage'
import { appendRecord, readRecords } from '../../session/transcript'

let server: DaemonServer | null = null
let tmp: string
afterEach(async () => { if (server) await server.close(); server = null; if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })

function makeFake() {
  const cp: any = new EventEmitter()
  cp.stdout = new EventEmitter(); cp.stderr = new EventEmitter()
  cp.stdin = { write: () => true, end: () => {} }
  cp.kill = () => true
  return cp
}

function startWith(db = openDatabase(':memory:'), transcriptDir?: string) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-m6-'))
  return startDaemon({ detect: () => ({ claude: '/x/claude', codex: '/x/codex' }), db, projectsDir: tmp, transcriptDir })
}

describe('POST /projects', () => {
  it('建项目：201 + projectId/path，真实建目录，落库可列', async () => {
    const db = openDatabase(':memory:')
    server = await startWith(db)
    const res = await fetch(server.url + '/projects', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '我的项目' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { projectId: string; path: string }
    expect(body.projectId).toBeTruthy()
    expect(body.path.startsWith(tmp)).toBe(true)
    expect(fs.existsSync(body.path)).toBe(true)
    expect(path.basename(body.path)).toBe(body.projectId)
    expect(listProjects(db).map((p) => p.id)).toContain(body.projectId)
  })

  it('name 缺失 → 400 invalid_request', async () => {
    server = await startWith()
    const res = await fetch(server.url + '/projects', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}),
    })
    expect(res.status).toBe(400)
    expect((await res.json() as any).error.code).toBe('invalid_request')
  })

  it('GET /projects 列出项目', async () => {
    const db = openDatabase(':memory:')
    server = await startWith(db)
    await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'A' }) })
    const res = await fetch(server.url + '/projects')
    expect(res.status).toBe(200)
    expect((await res.json() as { projects: any[] }).projects).toHaveLength(1)
  })
})

describe('会话路由', () => {
  it('POST /sessions：建会话 201 + sessionId', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    server = await startWith(db)
    const res = await fetch(server.url + '/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: proj.id, engine: 'claude', model: 'opus' }),
    })
    expect(res.status).toBe(201)
    expect((await res.json() as any).sessionId).toBeTruthy()
  })

  it('POST /sessions：projectId 不存在 → 404 not_found', async () => {
    server = await startWith()
    const res = await fetch(server.url + '/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'nope', engine: 'claude', model: 'opus' }),
    })
    expect(res.status).toBe(404)
    expect((await res.json() as any).error.code).toBe('not_found')
  })

  it('GET /projects/:id/sessions：列出会话（最近在前）', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus', title: 'S1' })
    server = await startWith(db)
    const res = await fetch(server.url + `/projects/${proj.id}/sessions`)
    expect((await res.json() as { sessions: any[] }).sessions[0].title).toBe('S1')
  })

  it('POST /sessions 带 permissionMode/effort → 列表回填（Issue 13/29）', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    server = await startWith(db)
    const r = await fetch(server.url + '/sessions', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: proj.id, engine: 'claude', model: 'opus', permissionMode: 'plan', effort: 'max' }),
    })
    const { sessionId } = await r.json() as { sessionId: string }
    const list = (await (await fetch(server.url + `/projects/${proj.id}/sessions`)).json() as { sessions: any[] }).sessions
    expect(list.find((s) => s.id === sessionId)).toMatchObject({ permissionMode: 'plan', effort: 'max' })
  })

  it('GET /sessions/:id/messages：按插入顺序返回历史消息', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-tr-'))
    appendRecord(tdir, s.id, 'claude', 'user_prompt', { text: 'hi', attachments: [] })
    server = await startWith(db, tdir)
    const res = await fetch(server.url + `/sessions/${s.id}/messages`)
    expect((await res.json() as { messages: any[] }).messages[0].role).toBe('user')
  })

  it('GET /sessions/:id/messages：重建 claude 回合，sdkMessageId 正确', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-tr-'))
    appendRecord(tdir, s.id, 'claude', 'user_prompt', { text: '问', attachments: [] })
    appendRecord(tdir, s.id, 'claude', 'assistant', { type: 'assistant', message: { id: 'm1', content: [{ type: 'text', text: '答' }] }, uuid: 'u' })
    appendRecord(tdir, s.id, 'claude', 'assistant_blocks', { blocks: [{ type: 'text', text: '答' }] })
    appendRecord(tdir, s.id, 'claude', 'result', { type: 'result', is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    server = await startWith(db, tdir)
    const res = await fetch(server.url + `/sessions/${s.id}/messages`)
    const { messages } = await res.json() as { messages: any[] }
    expect(messages.map((m: any) => m.role)).toEqual(['user', 'assistant'])
    expect(messages[1].sdkMessageId).toBe('m1')
  })

  it('GET /sessions/:id/raw：找到记录 / 缺 msgId 400 / 未知 msgId 404', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-tr-'))
    appendRecord(tdir, s.id, 'claude', 'assistant', { type: 'assistant', message: { id: 'mX', content: [] }, uuid: 'u2' })
    server = await startWith(db, tdir)
    // 找到
    const res = await fetch(server.url + `/sessions/${s.id}/raw?msgId=mX`)
    expect(res.status).toBe(200)
    expect((await res.json() as any).record.raw.message.id).toBe('mX')
    // 缺 msgId
    expect((await fetch(server.url + `/sessions/${s.id}/raw`)).status).toBe(400)
    // 未知 msgId
    expect((await fetch(server.url + `/sessions/${s.id}/raw?msgId=nope`)).status).toBe(404)
  })
})

describe('submit / interrupt / resume 端点', () => {
  it('POST /sessions/:id/messages：202，user 消息落库（runtime.submit 被调）', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'codex', model: 'gpt-5' })
    const { SessionRuntime } = await import('../../session/sessionRuntime')
    const tdir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-tr-'))
    const runtime = new SessionRuntime({ db, resolveBin: () => '/bin', spawnFn: (() => makeFake()) as any, transcriptDir: tdir })
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db, runtime, projectsDir: (tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-m6-'))) })
    const res = await fetch(server.url + `/sessions/${s.id}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '你好' }),
    })
    expect(res.status).toBe(202)
    expect(readRecords(tdir, s.id)[0]).toMatchObject({ type: 'user_prompt', raw: { text: '你好' } })
  })

  it('POST /sessions/:id/messages：会话不存在 → 404', async () => {
    server = await startWith()
    const res = await fetch(server.url + '/sessions/nope/messages', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'x' }),
    })
    expect(res.status).toBe(404)
  })

  it('POST /sessions/:id/messages 带 permissionMode/effort → 落库（Issue 13/29）', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    const { SessionRuntime } = await import('../../session/sessionRuntime')
    const runtime = new SessionRuntime({ db, resolveBin: () => '/bin', spawnFn: (() => makeFake()) as any, transcriptDir: fs.mkdtempSync(path.join(os.tmpdir(), 'as-tr-')) })
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db, runtime, projectsDir: (tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-m6-'))) })
    await fetch(server.url + `/sessions/${s.id}/messages`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text: '你好', permissionMode: 'acceptEdits', effort: 'high' }),
    })
    const list = (await (await fetch(server.url + `/projects/${proj.id}/sessions`)).json() as { sessions: any[] }).sessions
    expect(list.find((x) => x.id === s.id)).toMatchObject({ permissionMode: 'acceptEdits', effort: 'high' })
  })

  it('POST /sessions/:id/interrupt：202（空闲会话 no-op 也 202）', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'codex', model: 'gpt-5' })
    server = await startWith(db)
    const res = await fetch(server.url + `/sessions/${s.id}/interrupt`, { method: 'POST' })
    expect(res.status).toBe(202)
  })

  it('POST /sessions/:id/resume：202，带 text 续接', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'codex', model: 'gpt-5' })
    const { SessionRuntime } = await import('../../session/sessionRuntime')
    const runtime = new SessionRuntime({ db, resolveBin: () => '/bin', spawnFn: (() => makeFake()) as any, transcriptDir: fs.mkdtempSync(path.join(os.tmpdir(), 'as-tr-')) })
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db, runtime, projectsDir: (tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-m6-'))) })
    const res = await fetch(server.url + `/sessions/${s.id}/resume`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '继续' }),
    })
    expect(res.status).toBe(202)
  })
})

describe('GET /sessions/:id/status', () => {
  it('返回 {running, status}', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    server = await startWith(db)
    const body = await (await fetch(server.url + `/sessions/${s.id}/status`)).json() as { running: boolean; status: string }
    expect(body).toEqual({ running: false, status: 'idle' })
  })
  it('不存在 → 404', async () => {
    server = await startWith()
    expect((await fetch(server.url + '/sessions/nope/status')).status).toBe(404)
  })
})

describe('文件工作区端点', () => {
  it('GET /projects/:id/files：目录树', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string; path: string }
    fs.writeFileSync(path.join(proj.path, 'hello.txt'), 'hi')
    const body = await (await fetch(server.url + `/projects/${proj.projectId}/files`)).json() as { tree: any[] }
    expect(body.tree.map((n) => n.name)).toContain('hello.txt')
  })
  it('files 项目不存在 → 404', async () => { server = await startWith(); expect((await fetch(server.url + '/projects/nope/files')).status).toBe(404) })
  it('GET /projects/:id/file?path=：读内容', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string; path: string }
    fs.writeFileSync(path.join(proj.path, 'a.md'), '# 标题')
    expect((await (await fetch(server.url + `/projects/${proj.projectId}/file?path=a.md`)).json() as any).content).toBe('# 标题')
  })
  it('file 缺 path 400 / 越界 400 / 不存在 404', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string }
    expect((await fetch(server.url + `/projects/${proj.projectId}/file`)).status).toBe(400)
    expect((await fetch(server.url + `/projects/${proj.projectId}/file?path=${encodeURIComponent('../../etc/passwd')}`)).status).toBe(400)
    expect((await fetch(server.url + `/projects/${proj.projectId}/file?path=nope`)).status).toBe(404)
  })
  it('GET /pf/:id/<path>：原始字节流 + 按扩展名 Content-Type', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string; path: string }
    fs.mkdirSync(path.join(proj.path, 'sub'), { recursive: true })
    fs.writeFileSync(path.join(proj.path, 'sub', 'page.html'), '<h1>Hi</h1>')
    const res = await fetch(server.url + `/pf/${proj.projectId}/sub/page.html`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('text/html')
    expect(await res.text()).toBe('<h1>Hi</h1>')
  })
  it('GET /pf：URL 编码的中文路径解码后命中', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string; path: string }
    fs.writeFileSync(path.join(proj.path, '图片.txt'), 'CN')
    const res = await fetch(server.url + `/pf/${proj.projectId}/${encodeURIComponent('图片.txt')}`)
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('CN')
  })
  it('GET /pf：项目不存在 404 / 越界 400 / 不存在 404', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string }
    expect((await fetch(server.url + `/pf/nope/x.txt`)).status).toBe(404)
    expect((await fetch(server.url + `/pf/${proj.projectId}/${encodeURIComponent('../../etc/passwd')}`)).status).toBe(400)
    expect((await fetch(server.url + `/pf/${proj.projectId}/nope.txt`)).status).toBe(404)
  })
  it('POST /projects/:id/create：新建文件/目录 + 返回新树（Issue 15）', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string; path: string }
    const r = await fetch(server.url + `/projects/${proj.projectId}/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'docs/note.md', kind: 'file' }) })
    expect(r.status).toBe(200)
    expect(fs.existsSync(path.join(proj.path, 'docs', 'note.md'))).toBe(true)
    const rd = await fetch(server.url + `/projects/${proj.projectId}/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'assets', kind: 'dir' }) })
    expect(rd.status).toBe(200)
    expect(fs.statSync(path.join(proj.path, 'assets')).isDirectory()).toBe(true)
  })
  it('POST create：已存在 409 / 越界 400 / 缺 path 400', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string; path: string }
    fs.writeFileSync(path.join(proj.path, 'dup.txt'), 'x')
    expect((await fetch(server.url + `/projects/${proj.projectId}/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: 'dup.txt', kind: 'file' }) })).status).toBe(409)
    expect((await fetch(server.url + `/projects/${proj.projectId}/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ path: '../escape.txt', kind: 'file' }) })).status).toBe(400)
    expect((await fetch(server.url + `/projects/${proj.projectId}/create`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ kind: 'file' }) })).status).toBe(400)
  })
  it('GET /projects/:id/fs-stream：连通 + 文件变更推 files-changed（Issue 19）', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string; path: string }
    const ctrl = new AbortController()
    const res = await fetch(server.url + `/projects/${proj.projectId}/fs-stream`, { signal: ctrl.signal })
    expect(res.status).toBe(200)
    const reader = res.body!.getReader()
    const dec = new TextDecoder()
    // 起监听后写文件 → 期待收到 files-changed 帧
    setTimeout(() => { fs.writeFileSync(path.join(proj.path, 'created.txt'), 'hi') }, 50)
    let buf = ''
    let got = false
    const deadline = Date.now() + 3000
    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      if (buf.includes('files-changed')) { got = true; break }
    }
    ctrl.abort()
    expect(got).toBe(true)
  })
  it('POST /projects/:id/import-files：拖入复制进项目根 + 返回新树', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string; path: string }
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-src-')); const src = path.join(srcDir, 'drop.txt'); fs.writeFileSync(src, 'X')
    const res = await fetch(server.url + `/projects/${proj.projectId}/import-files`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: [src] }) })
    expect(res.status).toBe(200)
    const body = await res.json() as { imported: { name: string }[]; tree: { name: string }[] }
    expect(body.imported.map(i => i.name)).toEqual(['drop.txt'])
    expect(body.tree.map(n => n.name)).toContain('drop.txt')
    expect(fs.readFileSync(path.join(proj.path, 'drop.txt'), 'utf8')).toBe('X')
    fs.rmSync(srcDir, { recursive: true, force: true })
  })
  it('POST /projects/:id/import-files {dir:"attachments"}：复制进子目录', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string; path: string }
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-src-')); const src = path.join(srcDir, 'a.txt'); fs.writeFileSync(src, 'X')
    const res = await fetch(server.url + `/projects/${proj.projectId}/import-files`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: [src], dir: 'attachments' }) })
    expect(res.status).toBe(200)
    const body = await res.json() as { imported: { name: string }[] }
    expect(body.imported.map(i => i.name)).toEqual(['a.txt'])
    expect(fs.readFileSync(path.join(proj.path, 'attachments', 'a.txt'), 'utf8')).toBe('X')
    expect(fs.existsSync(path.join(proj.path, 'a.txt'))).toBe(false)
    fs.rmSync(srcDir, { recursive: true, force: true })
  })
  it('POST /projects/:id/attachments/paste：multipart 字节写进 attachments/', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string; path: string }
    const form = new FormData()
    form.append('file', new Blob([new Uint8Array([1, 2, 3])], { type: 'image/png' }), 'pasted-1.png')
    const res = await fetch(server.url + `/projects/${proj.projectId}/attachments/paste`, { method: 'POST', body: form })
    expect(res.status).toBe(200)
    const body = await res.json() as { file: { name: string; path: string; size: number } }
    expect(body.file).toMatchObject({ name: 'pasted-1.png', path: 'attachments/pasted-1.png', size: 3 })
    expect(fs.readFileSync(path.join(proj.path, 'attachments', 'pasted-1.png'))).toEqual(Buffer.from([1, 2, 3]))
  })
  it('paste 项目不存在 → 404 / 无文件 → 400', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string }
    const emptyForm = new FormData()
    expect((await fetch(server.url + '/projects/nope/attachments/paste', { method: 'POST', body: (() => { const f = new FormData(); f.append('file', new Blob([new Uint8Array([1])]), 'a.png'); return f })() })).status).toBe(404)
    expect((await fetch(server.url + `/projects/${proj.projectId}/attachments/paste`, { method: 'POST', body: emptyForm })).status).toBe(400)
  })
  it('import-files 项目不存在 → 404 / paths 非数组 → 400', async () => {
    const db = openDatabase(':memory:'); server = await startWith(db)
    const proj = await (await fetch(server.url + '/projects', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'P' }) })).json() as { projectId: string }
    expect((await fetch(server.url + '/projects/nope/import-files', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: [] }) })).status).toBe(404)
    expect((await fetch(server.url + `/projects/${proj.projectId}/import-files`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ paths: 'x' }) })).status).toBe(400)
  })
})

describe('轻量写端点', () => {
  it('PUT /projects/:id {name} → 200，名称已改', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: '旧名', path: '/w' })
    server = await startWith(db)
    const res = await fetch(server.url + `/projects/${proj.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: '新名' }) })
    expect(res.status).toBe(200)
    expect((await res.json() as any).ok).toBe(true)
    const { listProjects: lp } = await import('../../db/projects')
    expect(lp(db)[0].name).toBe('新名')
  })
  it('PUT /projects/:id 项目不存在 → 404', async () => {
    server = await startWith()
    expect((await fetch(server.url + '/projects/nope', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'x' }) })).status).toBe(404)
  })
  it('PATCH /sessions/:id {pinned,title} → 200，列已改', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    server = await startWith(db)
    const res = await fetch(server.url + `/sessions/${s.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pinned: true, title: '改名' }) })
    expect(res.status).toBe(200)
    const { getSession: gs } = await import('../../db/sessions')
    const updated = gs(db, s.id)!
    expect(updated.pinned).toBe(true); expect(updated.title).toBe('改名')
  })
  it('PATCH /sessions/:id 不存在 → 404', async () => {
    server = await startWith()
    expect((await fetch(server.url + '/sessions/nope', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ pinned: true }) })).status).toBe(404)
  })
  it('GET /sessions/:id/usage → {inputTokens,outputTokens,costUsd}', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    recordUsage(db, { sessionId: s.id, turn: 1, inputTokens: 10, outputTokens: 5, costUsd: 0.1 })
    server = await startWith(db)
    const body = await (await fetch(server.url + `/sessions/${s.id}/usage`)).json() as any
    expect(body).toMatchObject({ inputTokens: 10, outputTokens: 5, costUsd: 0.1 })
  })
  it('GET /sessions/:id/usage 不存在 → 404', async () => {
    server = await startWith()
    expect((await fetch(server.url + '/sessions/nope/usage')).status).toBe(404)
  })
  it('DELETE /sessions/:id → 200，会话连同 messages/usage 一并删除', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    appendMessage(db, { sessionId: s.id, role: 'user', blocks: [{ type: 'text', text: 'hi' }] })
    recordUsage(db, { sessionId: s.id, turn: 1, inputTokens: 1, outputTokens: 1, costUsd: 0 })
    server = await startWith(db)
    const res = await fetch(server.url + `/sessions/${s.id}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const { getSession: gs } = await import('../../db/sessions')
    expect(gs(db, s.id)).toBeUndefined()
    expect(getMsgs(db, s.id)).toEqual([])
  })
  it('DELETE /sessions/:id 不存在 → 404', async () => {
    server = await startWith()
    expect((await fetch(server.url + '/sessions/nope', { method: 'DELETE' })).status).toBe(404)
  })
})

describe('技能注入', () => {
  it('createProject 带 skills → 软链进项目 .claude/skills', async () => {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'as-lib-'))
    fs.mkdirSync(path.join(lib, 'guizang-ppt'))
    fs.writeFileSync(path.join(lib, 'guizang-ppt', 'SKILL.md'), '---\nname: guizang-ppt\ndescription: d\n---')
    const pdir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-pd-'))
    const s = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), projectsDir: pdir, skillsDir: lib })
    try {
      const res = await fetch(`${s.url}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ name: 'P', skills: ['guizang-ppt'] }),
      })
      const { projectId } = await res.json() as { projectId: string }
      expect(fs.existsSync(path.join(pdir, projectId, '.claude', 'skills', 'guizang-ppt', 'SKILL.md'))).toBe(true)
    } finally {
      await s.close()
      fs.rmSync(lib, { recursive: true, force: true })
      fs.rmSync(pdir, { recursive: true, force: true })
    }
  })
})

describe('GET /sessions/:id/stream (SSE)', () => {
  it('返回 text/event-stream，submit 后能收到实时事件帧', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'codex', model: 'gpt-5' })
    const children: any[] = []
    const { SessionRuntime } = await import('../../session/sessionRuntime')
    const runtime = new SessionRuntime({ db, resolveBin: () => '/bin', spawnFn: (() => { const c = makeFake(); children.push(c); return c }) as any, transcriptDir: fs.mkdtempSync(path.join(os.tmpdir(), 'as-tr-')) })
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db, runtime, projectsDir: (tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-m6-'))) })

    const ac = new AbortController()
    const res = await fetch(server.url + `/sessions/${s.id}/stream`, { signal: ac.signal })
    expect(res.headers.get('content-type')).toContain('text/event-stream')

    await fetch(server.url + `/sessions/${s.id}/messages`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: 'hi' }) })
    const cp = children[0]
    cp.stdout.emit('data', JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: '答' } }) + '\n')

    const reader = res.body!.getReader()
    const decoder = new TextDecoder()
    let collected = ''
    // 循环读直到收到包含事件帧的 chunk（首帧是 ": connected"，需跳过）
    while (!collected.includes('event: message')) {
      const { value, done } = await reader.read()
      if (done) break
      collected += decoder.decode(value, { stream: true })
    }
    expect(collected).toContain('event: message')
    expect(collected).toContain('"text":"答"')
    ac.abort()
    await reader.cancel().catch(() => {})
  })
})
