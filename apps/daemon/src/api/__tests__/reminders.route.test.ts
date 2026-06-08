/**
 * T3：reminders 路由测试（TDD 先行）
 * - GET/PUT /projects/:id/reminders
 * - GET/PUT /reminders/default
 * - POST /projects/:id/reminders/sounds（上传音频）
 * - GET  /projects/:id/reminders/sounds/:name（回放）
 * - 建项目拷贝全局默认
 */
import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'
import { createProject } from '../../db/projects'
import type { RemindersConfig } from '@agent-shell/contracts'

let server: DaemonServer | null = null
let tmp: string

afterEach(async () => {
  if (server) await server.close()
  server = null
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
})

// ── 建 daemon，dataDir（全局默认 reminders）可注入 ─────────────────────
function startWith(db = openDatabase(':memory:'), extra: { dataDir?: string; projectsDir?: string } = {}) {
  tmp = extra.projectsDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'as-rmd-'))
  // 注入 AGENT_SHELL_DATA_DIR 让 remindersDefaultPath() 指向 tmp 下的 data 目录
  const dataDir = extra.dataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), 'as-data-'))
  // 通过 env 覆盖 channelDataDir
  const origDataDir = process.env.AGENT_SHELL_DATA_DIR
  process.env.AGENT_SHELL_DATA_DIR = path.relative(os.homedir(), dataDir)
  const s = startDaemon({ detect: () => ({ claude: '/x/claude', codex: '/x/codex' }), db, projectsDir: tmp })
  // 恢复 env
  process.env.AGENT_SHELL_DATA_DIR = origDataDir
  return { promise: s, dataDir }
}

// ── 完整配置样本 ──────────────────────────────────────────────────────
const SAMPLE_CFG: RemindersConfig = {
  version: 1,
  enabled: true,
  events: {
    attention: { channels: ['audio'], sound: { kind: 'system', id: 'crisp' } },
    complete: { channels: ['inapp'], sound: { kind: 'system', id: 'chime' } },
    failed: { channels: ['system', 'audio'], sound: { kind: 'system', id: 'alert' } },
  },
  external: {
    webhook: { enabled: false, secretRef: null },
    feishu: { enabled: false, secretRef: null },
  },
}

// ── 音频 FormData 辅助 ────────────────────────────────────────────────
function makeAudio(name: string, bytes: Uint8Array, type = 'audio/mpeg'): FormData {
  const form = new FormData()
  form.append('file', new Blob([bytes], { type }), name)
  return form
}

// ─────────────────────────────────────────────────────────────────────
describe('GET/PUT /projects/:id/reminders', () => {
  it('无文件 GET → enabled:false 默认', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'P', path: fs.mkdtempSync(path.join(os.tmpdir(), 'as-p-')) })
    const { promise } = startWith(db)
    server = await promise
    const res = await fetch(server.url + `/projects/${proj.id}/reminders`)
    expect(res.status).toBe(200)
    const body = await res.json() as RemindersConfig
    expect(body.enabled).toBe(false)
  })

  it('项目不存在 → 404', async () => {
    const { promise } = startWith()
    server = await promise
    expect((await fetch(server.url + '/projects/nope/reminders')).status).toBe(404)
  })

  it('PUT 写配置，GET 读回相等', async () => {
    const db = openDatabase(':memory:')
    const projPath = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p-'))
    const proj = createProject(db, { name: 'P', path: projPath })
    const { promise } = startWith(db)
    server = await promise
    const putRes = await fetch(server.url + `/projects/${proj.id}/reminders`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE_CFG),
    })
    expect(putRes.status).toBe(200)
    const getRes = await fetch(server.url + `/projects/${proj.id}/reminders`)
    const body = await getRes.json() as RemindersConfig
    expect(body.enabled).toBe(true)
    expect(body.events.attention.channels).toContain('audio')
    // 确认真实落盘
    const agentDir = path.join(projPath, '.agent-shell')
    expect(fs.existsSync(path.join(agentDir, 'reminders.json'))).toBe(true)
  })

  it('PUT body 非法 → 400', async () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'P', path: fs.mkdtempSync(path.join(os.tmpdir(), 'as-p-')) })
    const { promise } = startWith(db)
    server = await promise
    const res = await fetch(server.url + `/projects/${proj.id}/reminders`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ enabled: 'not-bool' }),
    })
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────
describe('GET/PUT /reminders/default', () => {
  // 这些测试需要 AGENT_SHELL_DATA_DIR env 在整个请求生命周期内保持，
  // 不能在 startDaemon 后就恢复 —— paths.ts 的 channelDataDir() 是运行时动态算的。
  let savedDataDir: string | undefined
  let dataDirs: string[] = []

  afterEach(() => {
    // 恢复原始 env
    if (savedDataDir === undefined) delete process.env.AGENT_SHELL_DATA_DIR
    else process.env.AGENT_SHELL_DATA_DIR = savedDataDir
    savedDataDir = undefined
    for (const d of dataDirs) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }
    dataDirs = []
  })

  function isolateDataDir() {
    savedDataDir = process.env.AGENT_SHELL_DATA_DIR
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-data-'))
    dataDirs.push(dataDir)
    process.env.AGENT_SHELL_DATA_DIR = path.relative(os.homedir(), dataDir)
    return dataDir
  }

  it('无文件 GET → enabled:false 默认', async () => {
    isolateDataDir()
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db: openDatabase(':memory:') })
    const res = await fetch(server.url + '/reminders/default')
    expect(res.status).toBe(200)
    const body = await res.json() as RemindersConfig
    expect(body.enabled).toBe(false)
  })

  it('PUT 写全局默认，GET 读回相等', async () => {
    const dataDir = isolateDataDir()
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db: openDatabase(':memory:') })
    const putRes = await fetch(server.url + '/reminders/default', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(SAMPLE_CFG),
    })
    expect(putRes.status).toBe(200)
    const getRes = await fetch(server.url + '/reminders/default')
    const body = await getRes.json() as RemindersConfig
    expect(body.enabled).toBe(true)
    // 确认真实落盘到 dataDir
    expect(fs.existsSync(path.join(dataDir, 'reminders.default.json'))).toBe(true)
  })

  it('PUT body 非法 → 400', async () => {
    isolateDataDir()
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db: openDatabase(':memory:') })
    const res = await fetch(server.url + '/reminders/default', {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bad: true }),
    })
    expect(res.status).toBe(400)
  })
})

// ─────────────────────────────────────────────────────────────────────
describe('POST /projects/:id/reminders/sounds（音频上传）', () => {
  it('合法 mp3 上传成功，返回相对路径，文件落盘', async () => {
    const db = openDatabase(':memory:')
    const projPath = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p-'))
    const proj = createProject(db, { name: 'P', path: projPath })
    const { promise } = startWith(db)
    server = await promise
    const bytes = new Uint8Array(100).fill(0xAA)
    const form = makeAudio('bell.mp3', bytes, 'audio/mpeg')
    const res = await fetch(server.url + `/projects/${proj.id}/reminders/sounds`, {
      method: 'POST', body: form,
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { file: string }
    expect(body.file).toMatch(/\.agent-shell\/sounds\/bell\.mp3$/)
    // 确认落盘
    expect(fs.existsSync(path.join(projPath, '.agent-shell', 'sounds', 'bell.mp3'))).toBe(true)
  })

  it('wav / ogg / m4a 都合法', async () => {
    const db = openDatabase(':memory:')
    for (const [ext, mime] of [['a.wav', 'audio/wav'], ['b.ogg', 'audio/ogg'], ['c.m4a', 'audio/m4a']] as const) {
      const projPath = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p-'))
      const proj = createProject(db, { name: ext, path: projPath })
      const { promise } = startWith(db)
      server = await promise
      const form = makeAudio(ext, new Uint8Array(10).fill(1), mime)
      const res = await fetch(server.url + `/projects/${proj.id}/reminders/sounds`, { method: 'POST', body: form })
      expect(res.status).toBe(200)
      if (server) { await server.close(); server = null }
    }
  })

  it('超过 5MB → 400', async () => {
    const db = openDatabase(':memory:')
    const projPath = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p-'))
    const proj = createProject(db, { name: 'P', path: projPath })
    const { promise } = startWith(db)
    server = await promise
    // 5MB + 1 byte
    const bigBytes = new Uint8Array(5 * 1024 * 1024 + 1).fill(0)
    const form = makeAudio('big.mp3', bigBytes, 'audio/mpeg')
    const res = await fetch(server.url + `/projects/${proj.id}/reminders/sounds`, {
      method: 'POST', body: form,
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('file_too_large')
  })

  it('非法扩展名（.exe）→ 400 invalid_ext', async () => {
    const db = openDatabase(':memory:')
    const projPath = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p-'))
    const proj = createProject(db, { name: 'P', path: projPath })
    const { promise } = startWith(db)
    server = await promise
    const form = makeAudio('evil.exe', new Uint8Array(10), 'application/octet-stream')
    const res = await fetch(server.url + `/projects/${proj.id}/reminders/sounds`, {
      method: 'POST', body: form,
    })
    expect(res.status).toBe(400)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('invalid_ext')
  })

  it('无文件 → 400', async () => {
    const db = openDatabase(':memory:')
    const projPath = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p-'))
    const proj = createProject(db, { name: 'P', path: projPath })
    const { promise } = startWith(db)
    server = await promise
    const emptyForm = new FormData()
    const res = await fetch(server.url + `/projects/${proj.id}/reminders/sounds`, {
      method: 'POST', body: emptyForm,
    })
    expect(res.status).toBe(400)
  })

  it('项目不存在 → 404', async () => {
    const { promise } = startWith()
    server = await promise
    const form = makeAudio('a.mp3', new Uint8Array(10))
    expect((await fetch(server.url + '/projects/nope/reminders/sounds', { method: 'POST', body: form })).status).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────
describe('GET /projects/:id/reminders/sounds/:name（音频回放）', () => {
  it('上传后能 GET 字节 + 正确 Content-Type', async () => {
    const db = openDatabase(':memory:')
    const projPath = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p-'))
    const proj = createProject(db, { name: 'P', path: projPath })
    const { promise } = startWith(db)
    server = await promise
    // 先上传
    const bytes = new Uint8Array([0x49, 0x44, 0x33]) // ID3 magic
    const form = makeAudio('bell.mp3', bytes)
    await fetch(server.url + `/projects/${proj.id}/reminders/sounds`, { method: 'POST', body: form })
    // 再 GET
    const res = await fetch(server.url + `/projects/${proj.id}/reminders/sounds/bell.mp3`)
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toContain('audio/mpeg')
    const buf = Buffer.from(await res.arrayBuffer())
    expect(buf).toEqual(Buffer.from(bytes))
  })

  it('文件不存在 → 404', async () => {
    const db = openDatabase(':memory:')
    const projPath = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p-'))
    const proj = createProject(db, { name: 'P', path: projPath })
    const { promise } = startWith(db)
    server = await promise
    expect((await fetch(server.url + `/projects/${proj.id}/reminders/sounds/nope.mp3`)).status).toBe(404)
  })

  it('路径穿越（..%2f 编码）被拒 400', async () => {
    const db = openDatabase(':memory:')
    const projPath = fs.mkdtempSync(path.join(os.tmpdir(), 'as-p-'))
    const proj = createProject(db, { name: 'P', path: projPath })
    const { promise } = startWith(db)
    server = await promise
    // 用 encodeURIComponent 确保穿越字符真正到达路由
    const res = await fetch(server.url + `/projects/${proj.id}/reminders/sounds/..%2Fconfig.json`)
    expect(res.status).toBe(400)
  })

  it('项目不存在 → 404', async () => {
    const { promise } = startWith()
    server = await promise
    expect((await fetch(server.url + '/projects/nope/reminders/sounds/a.mp3')).status).toBe(404)
  })
})

// ─────────────────────────────────────────────────────────────────────
describe('建项目时拷贝全局默认', () => {
  // AGENT_SHELL_DATA_DIR 必须在整个测试期间保持（remindersDefaultPath 是运行时动态算的）
  let savedDataDir: string | undefined
  const cleanupDirs: string[] = []

  afterEach(() => {
    if (savedDataDir === undefined) delete process.env.AGENT_SHELL_DATA_DIR
    else process.env.AGENT_SHELL_DATA_DIR = savedDataDir
    savedDataDir = undefined
    for (const d of cleanupDirs.splice(0)) { try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ } }
  })

  it('有全局默认 → 新项目有 reminders.json 且内容一致', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-data-'))
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-pdir-'))
    cleanupDirs.push(dataDir, projDir)
    savedDataDir = process.env.AGENT_SHELL_DATA_DIR
    // 先写全局默认（env 设好后再写，确保路径对）
    process.env.AGENT_SHELL_DATA_DIR = path.relative(os.homedir(), dataDir)
    const defaultFile = path.join(dataDir, 'reminders.default.json')
    fs.writeFileSync(defaultFile, JSON.stringify(SAMPLE_CFG, null, 2))
    // 启 daemon（env 保持，不恢复）
    server = await startDaemon({
      detect: () => ({ claude: '/x', codex: '/x' }),
      db: openDatabase(':memory:'),
      projectsDir: projDir,
    })
    // 建项目
    const res = await fetch(server.url + '/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '带默认的项目' }),
    })
    const { path: projPath } = await res.json() as { path: string }
    const copied = path.join(projPath, '.agent-shell', 'reminders.json')
    expect(fs.existsSync(copied)).toBe(true)
    const content = JSON.parse(fs.readFileSync(copied, 'utf8')) as RemindersConfig
    expect(content.enabled).toBe(true)
    expect(content.events.attention.channels).toContain('audio')
  })

  it('无全局默认 → 新项目无 reminders.json', async () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-data-'))
    const projDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-pdir-'))
    cleanupDirs.push(dataDir, projDir)
    savedDataDir = process.env.AGENT_SHELL_DATA_DIR
    process.env.AGENT_SHELL_DATA_DIR = path.relative(os.homedir(), dataDir)
    // 不写 reminders.default.json，模拟无全局默认
    server = await startDaemon({
      detect: () => ({ claude: '/x', codex: '/x' }),
      db: openDatabase(':memory:'),
      projectsDir: projDir,
    })
    const res = await fetch(server.url + '/projects', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ name: '无默认项目' }),
    })
    const { path: projPath } = await res.json() as { path: string }
    const copied = path.join(projPath, '.agent-shell', 'reminders.json')
    expect(fs.existsSync(copied)).toBe(false)
  })
})
