import { describe, it, expect, afterEach, beforeAll } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../server'
import { openDatabase } from '../db/database'

const detect = () => ({ claude: '/x/claude', codex: null })
let server: DaemonServer | null = null
let webDir = ''

beforeAll(() => {
  webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm8a-web-'))
  fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>shell</title><div id=root>OK</div>')
  fs.mkdirSync(path.join(webDir, 'assets'))
  fs.writeFileSync(path.join(webDir, 'assets', 'app.js'), 'console.log(1)')
})
afterEach(async () => { if (server) await server.close(); server = null })

describe('daemon serve renderer（webDir）', () => {
  it('GET / 返回 index.html', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:'), webDir })
    const res = await fetch(server.url + '/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('id=root')
  })

  it('GET /assets/app.js 返回静态资源', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:'), webDir })
    const res = await fetch(server.url + '/assets/app.js')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('console.log')
  })

  it('GET /api/health 剥掉 /api 后命中现有路由', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:'), webDir })
    const res = await fetch(server.url + '/api/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('未知非-/api 路径回退到 index.html（SPA fallback）', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:'), webDir })
    const res = await fetch(server.url + '/some/client/route')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('id=root')
  })

  it('未配 webDir 时 GET / 返回 404（dev 形态不 serve）', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:') })
    const res = await fetch(server.url + '/')
    expect(res.status).toBe(404)
  })

  it('未知 /api/* → 404 JSON（不回退 index.html）', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:'), webDir })
    const res = await fetch(server.url + '/api/nope')
    expect(res.status).toBe(404)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe('not_found')
  })
})
