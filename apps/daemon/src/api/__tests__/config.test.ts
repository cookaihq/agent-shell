import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'

let server: DaemonServer, tmp: string
afterEach(async () => { await server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })

describe('/config', () => {
  it('GET 返回当前 config（projectsDir/skillsDir）', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cfg-'))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), projectsDir: tmp, skillsDir: tmp })
    const res = await fetch(`${server.url}/config`)
    const body = await res.json() as { projectsDir: string; skillsDir: string }
    expect(body.projectsDir).toBe(tmp)
    expect(body.skillsDir).toBe(tmp)
  })

  it('PUT engineModels 持久化 + GET 回读', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cfg-'))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }) })
    const putRes = await fetch(`${server.url}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engineModels: { claude: 'claude-sonnet-4-5' } }),
    })
    expect(putRes.status).toBe(200)
    const getRes = await fetch(`${server.url}/config`)
    const body = await getRes.json() as { engineModels?: Record<string, string> }
    expect(body.engineModels?.claude).toBe('claude-sonnet-4-5')
  })

  it('PUT engineModels 按引擎合并（第二次不覆盖第一次）', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cfg-'))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }) })
    await fetch(`${server.url}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engineModels: { claude: 'claude-sonnet-4-5' } }),
    })
    await fetch(`${server.url}/config`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ engineModels: { codex: 'gpt-5.5' } }),
    })
    const getRes = await fetch(`${server.url}/config`)
    const body = await getRes.json() as { engineModels?: Record<string, string> }
    expect(body.engineModels?.claude).toBe('claude-sonnet-4-5')
    expect(body.engineModels?.codex).toBe('gpt-5.5')
  })
})
