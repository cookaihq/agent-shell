import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'
import { makeProviderStore } from '../../providers/store'
import { makeAuthSourceStore } from '../../auth/sourceStore'

let server: DaemonServer | null = null
afterEach(async () => { if (server) await server.close(); server = null })

// 这些路由用例不走密钥库引用，secrets 仅作占位（getValue 恒空）
const fakeSecrets = { getValue: () => undefined }
function tmpStore() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-'))
  return makeProviderStore(path.join(d, 'providers.json'), fakeSecrets, makeAuthSourceStore(path.join(d, 'auth.json')), { get: () => undefined })
}
async function start() {
  const providers = tmpStore()
  server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db: openDatabase(':memory:'), providers })
  return { url: server.url, providers }
}
const J = { 'content-type': 'application/json' }

describe('provider routes', () => {
  it('POST /providers 创建并回掩码（无明文 key）', async () => {
    const { url } = await start()
    const res = await fetch(url + '/providers', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', name: '中转', baseUrl: 'https://x', apiKey: 'sk-abcdef1234' }) })
    expect(res.status).toBe(201)
    const body = await res.json() as { provider: { maskedKey: string; apiKey?: string } }
    expect(body.provider.maskedKey).toBe('sk-…1234')
    expect(body.provider.apiKey).toBeUndefined()
  })
  it('GET /providers 不回明文 key', async () => {
    const { url } = await start()
    await fetch(url + '/providers', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', name: 'x', baseUrl: 'https://x', apiKey: 'sk-secret-abcdef' }) })
    const text = await (await fetch(url + '/providers')).text()
    expect(text).not.toContain('sk-secret-abcdef')
  })
  it('PUT /providers/active 设当前', async () => {
    const { url } = await start()
    const c = await (await fetch(url + '/providers', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', name: 'x', baseUrl: 'https://x', apiKey: 'sk-1' }) })).json() as { provider: { id: string } }
    const res = await fetch(url + '/providers/active', { method: 'PUT', headers: J, body: JSON.stringify({ engine: 'claude', providerId: c.provider.id }) })
    expect(res.status).toBe(200)
    const list = await (await fetch(url + '/providers')).json() as { engines: { claude: { active: string } } }
    expect(list.engines.claude.active).toBe(c.provider.id)
  })
  it('PUT /providers/:id 编辑名称/baseUrl，apiKey 省略保留原 key，返回掩码', async () => {
    const { url } = await start()
    const c = await (await fetch(url + '/providers', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', name: 'a', baseUrl: 'https://x', apiKey: 'sk-orig-9999' }) })).json() as { provider: { id: string } }
    const res = await fetch(url + '/providers/' + c.provider.id, { method: 'PUT', headers: J, body: JSON.stringify({ name: 'b', baseUrl: 'https://y' }) })
    expect(res.status).toBe(200)
    const body = await res.json() as { provider: { name: string; baseUrl: string; maskedKey: string; apiKey?: string } }
    expect(body.provider.name).toBe('b')
    expect(body.provider.baseUrl).toBe('https://y')
    expect(body.provider.apiKey).toBeUndefined()
    expect(body.provider.maskedKey).toBe('sk-…9999')
  })
  it('PUT /providers/:id 不存在 → 404', async () => {
    const { url } = await start()
    const res = await fetch(url + '/providers/p_ghost', { method: 'PUT', headers: J, body: JSON.stringify({ name: 'x' }) })
    expect(res.status).toBe(404)
  })
  it('DELETE /providers/:id 删除当前项 → active 回落 default、列表清空', async () => {
    const { url } = await start()
    const c = await (await fetch(url + '/providers', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', name: 'a', baseUrl: 'https://x', apiKey: 'sk-1' }) })).json() as { provider: { id: string } }
    await fetch(url + '/providers/active', { method: 'PUT', headers: J, body: JSON.stringify({ engine: 'claude', providerId: c.provider.id }) })
    const res = await fetch(url + '/providers/' + c.provider.id, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const list = await (await fetch(url + '/providers')).json() as { engines: { claude: { active: string; providers: unknown[] } } }
    expect(list.engines.claude.active).toBe('default')
    expect(list.engines.claude.providers).toHaveLength(0)
  })
})
