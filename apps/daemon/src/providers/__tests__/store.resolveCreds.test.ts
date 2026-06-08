import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProviderStore } from '../store'
import { makeAuthSourceStore } from '../../auth/sourceStore'

// 仅实现 getValue：k_1 → 真实值，其余 undefined
const fakeSecrets = { getValue: (id: string) => (id === 'k_1' ? 'sk-real' : undefined) }
const dirs: string[] = []
// 每个 store 配独立的临时 sourceStore（凭证来源权威）+ providers 文件，共享同一临时目录
function makeStore() {
  const d = mkdtempSync(join(tmpdir(), 'prov-')); dirs.push(d)
  return makeProviderStore(join(d, 'providers.json'), fakeSecrets, makeAuthSourceStore(join(d, 'auth.json')), { get: () => undefined })
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('resolveActiveCreds + secretId', () => {
  it('apiKeySecretId → 经 SecretStore 解析出真实值', () => {
    const store = makeStore()
    const p = store.create({ engine: 'claude', name: 'X', baseUrl: 'https://api.x.com', apiKeySecretId: 'k_1', keyEnv: 'auth_token', models: [{ value: 'm', label: 'M' }], defaultModel: 'm', wireApi: 'responses' })
    store.setActive('claude', p.id)
    expect(store.resolveActiveCreds('claude')).toEqual({ baseUrl: 'https://api.x.com', apiKey: 'sk-real', keyEnv: 'auth_token' })
  })
  it('裸 apiKey（无 secretId）仍直接返回', () => {
    const store = makeStore()
    const p = store.create({ engine: 'claude', name: 'Y', baseUrl: 'https://api.y.com', apiKey: 'sk-bare', keyEnv: 'api_key', models: [{ value: 'm', label: 'M' }], defaultModel: 'm', wireApi: 'responses' })
    store.setActive('claude', p.id)
    expect(store.resolveActiveCreds('claude')).toEqual({ baseUrl: 'https://api.y.com', apiKey: 'sk-bare', keyEnv: 'api_key' })
  })
  it('apiKeySecretId 指向不存在的密钥 → apiKey 空串（不泄漏裸值）', () => {
    const store = makeStore()
    const p = store.create({ engine: 'claude', name: 'W', baseUrl: 'https://api.w.com', apiKeySecretId: 'k_missing', keyEnv: 'auth_token', models: [], wireApi: 'responses' })
    store.setActive('claude', p.id)
    expect(store.resolveActiveCreds('claude')).toEqual({ baseUrl: 'https://api.w.com', apiKey: '', keyEnv: 'auth_token' })
  })
  it('toView 回填 apiKeySecretId', () => {
    const store = makeStore()
    const p = store.create({ engine: 'claude', name: 'Z', baseUrl: 'https://api.z.com', apiKeySecretId: 'k_1', keyEnv: 'auth_token', models: [], wireApi: 'responses' })
    expect(p.apiKeySecretId).toBe('k_1')
  })
})
