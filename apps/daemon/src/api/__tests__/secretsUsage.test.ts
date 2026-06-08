import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'
import { makeProviderStore } from '../../providers/store'
import { makeAuthSourceStore } from '../../auth/sourceStore'
import { makeSecretStore } from '../../secrets/store'

let server: DaemonServer | null = null
afterEach(async () => { if (server) await server.close(); server = null })

const J = { 'content-type': 'application/json' }

// 密钥库/需求清单/Provider 各自隔离到临时文件
function start() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'su-'))
  const secretsPath = path.join(dir, 'secrets.json')
  const entityRequirementsPath = path.join(dir, 'entity-requirements.json')
  const secrets = makeSecretStore(secretsPath)
  const providers = makeProviderStore(path.join(dir, 'providers.json'), secrets, makeAuthSourceStore(path.join(dir, 'auth.json')), { get: () => undefined })
  return startDaemon({
    detect: () => ({ claude: '/x', codex: '/x' }),
    db: openDatabase(':memory:'),
    providers,
    secretsPath,
    entityRequirementsPath,
  }).then((s) => { server = s; return { url: s.url } })
}

describe('GET /secrets usage 区分技能/Provider', () => {
  it('同一密钥被 Provider 与技能引用时，usage 含 providers 与 skills 两侧', async () => {
    const { url } = await start()
    // 1) 建密钥
    const sk = await (await fetch(url + '/secrets', { method: 'POST', headers: J, body: JSON.stringify({ name: 'OPENAI_KEY', value: 'sk-xyz-1234' }) })).json() as { secret: { id: string } }
    const secretId = sk.secret.id
    // 2) Provider 引用该密钥（apiKeySecretId）
    await fetch(url + '/providers', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', name: '我的中转', baseUrl: 'https://x', apiKeySecretId: secretId, keyEnv: 'auth_token' }) })
    // 3) 技能实体需求把某槽位 bind 到该密钥
    await fetch(url + '/entity-requirements/' + encodeURIComponent('skill:guizang-ppt'), {
      method: 'PUT', headers: J,
      body: JSON.stringify({ needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'OPENAI_API_KEY', bind: secretId }] }),
    })

    const body = await (await fetch(url + '/secrets')).json() as { usage: Record<string, { skills: string[]; providers: string[] }> }
    const u = body.usage[secretId]
    expect(u).toBeTruthy()
    expect(u.providers).toContain('我的中转')
    expect(u.skills).toContain('skill:guizang-ppt')
  })

  it('仅被 Provider 引用时，usage 形如 {skills:[], providers:[name]}', async () => {
    const { url } = await start()
    const sk = await (await fetch(url + '/secrets', { method: 'POST', headers: J, body: JSON.stringify({ name: 'K', value: 'sk-only-prov' }) })).json() as { secret: { id: string } }
    const secretId = sk.secret.id
    await fetch(url + '/providers', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'codex', name: 'P', baseUrl: 'https://y', apiKeySecretId: secretId }) })

    const body = await (await fetch(url + '/secrets')).json() as { usage: Record<string, { skills: string[]; providers: string[] }> }
    expect(body.usage[secretId]).toEqual({ skills: [], providers: ['P'] })
  })
})
