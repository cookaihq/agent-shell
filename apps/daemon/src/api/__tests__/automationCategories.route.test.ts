import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'

let server: DaemonServer | null = null
let tmp: string
afterEach(async () => { if (server) await server.close(); server = null; if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })

const JSON_H = { 'content-type': 'application/json' }

describe('/automation-categories', () => {
  it('GET 缺文件 → {tree:[]}；PUT 后 GET 回读', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cat-'))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db: openDatabase(':memory:'), projectsDir: tmp, automationCategoriesPath: path.join(tmp, 'cats.json') })
    const g0 = await (await fetch(server.url + '/automation-categories')).json()
    expect(g0).toEqual({ tree: [] })
    const tree = [{ name: '运营', children: [{ name: '监控' }] }]
    const put = await fetch(server.url + '/automation-categories', { method: 'PUT', headers: JSON_H, body: JSON.stringify({ tree }) })
    expect(put.status).toBe(200)
    const g1 = await (await fetch(server.url + '/automation-categories')).json()
    expect(g1).toEqual({ tree })
  })

  it('PUT 非法树 → 400', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cat2-'))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db: openDatabase(':memory:'), projectsDir: tmp, automationCategoriesPath: path.join(tmp, 'c.json') })
    const put = await fetch(server.url + '/automation-categories', { method: 'PUT', headers: JSON_H, body: JSON.stringify({ tree: [{ bad: 1 }] }) })
    expect(put.status).toBe(400)
  })
})
