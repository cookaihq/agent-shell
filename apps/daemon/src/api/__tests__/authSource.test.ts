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

const fakeSecrets = { getValue: () => undefined }
// providers + authSources 共享同一临时 auth.json，使「自定义 provider 计入 custom」与来源状态走同一份隔离文件
function tmpEnv() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-'))
  const authStatePath = path.join(d, 'auth.json')
  const providers = makeProviderStore(path.join(d, 'providers.json'), fakeSecrets, makeAuthSourceStore(authStatePath), { get: () => undefined })
  return { authStatePath, providers }
}
async function start() {
  const { authStatePath, providers } = tmpEnv()
  // 注入 claudeLogin 桩：本测不关心 cliLogin，但要拦住真实 detectClaudeLogin 去 shell 出 security 读本机 keychain（env 依赖污染）
  server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db: openDatabase(':memory:'), providers, authStatePath, claudeLogin: () => ({ status: 'signed-out' }) })
  return { url: server.url, providers }
}
const J = { 'content-type': 'application/json' }

type Status = { engines: { claude: EngineStatus; codex: EngineStatus } }
type EngineStatus = { activeSource: string; officialKey: { secretId?: string }; custom: string[] }

describe('auth source routes', () => {
  it('GET /auth/status 默认两引擎 cli-login、无官网 key、custom 空', async () => {
    const { url } = await start()
    const st = await (await fetch(url + '/auth/status')).json() as Status
    for (const e of ['claude', 'codex'] as const) {
      expect(st.engines[e].activeSource).toBe('cli-login')
      expect(st.engines[e].officialKey.secretId).toBeUndefined()
      expect(st.engines[e].custom).toEqual([])
    }
  })

  it('PUT /auth/source 切 claude=official-key，codex 不变', async () => {
    const { url } = await start()
    const res = await fetch(url + '/auth/source', { method: 'PUT', headers: J, body: JSON.stringify({ engine: 'claude', source: 'official-key' }) })
    expect(res.status).toBe(200)
    const st = await (await fetch(url + '/auth/status')).json() as Status
    expect(st.engines.claude.activeSource).toBe('official-key')
    expect(st.engines.codex.activeSource).toBe('cli-login')
  })

  it('PUT /auth/official-key 设 claude 官网密钥引用', async () => {
    const { url } = await start()
    const res = await fetch(url + '/auth/official-key', { method: 'PUT', headers: J, body: JSON.stringify({ engine: 'claude', secretId: 'k_1' }) })
    expect(res.status).toBe(200)
    const st = await (await fetch(url + '/auth/status')).json() as Status
    expect(st.engines.claude.officialKey.secretId).toBe('k_1')
  })

  it('GET /auth/status 把该引擎自定义 provider 计入 custom', async () => {
    const { url } = await start()
    const c = await (await fetch(url + '/providers', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', name: '中转', baseUrl: 'https://x', apiKey: 'sk-1' }) })).json() as { provider: { id: string } }
    const st = await (await fetch(url + '/auth/status')).json() as Status
    expect(st.engines.claude.custom).toContain(c.provider.id)
  })

  it('PUT /auth/source 缺 engine → 400', async () => {
    const { url } = await start()
    const res = await fetch(url + '/auth/source', { method: 'PUT', headers: J, body: JSON.stringify({ source: 'official-key' }) })
    expect(res.status).toBe(400)
  })
})
