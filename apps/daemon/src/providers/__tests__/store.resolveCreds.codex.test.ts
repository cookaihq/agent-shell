import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProviderStore } from '../store'
import { makeAuthSourceStore } from '../../auth/sourceStore'

const fakeSecrets = { getValue: (id: string) => (id === 'k_1' ? 'sk-real' : undefined) }
const dirs: string[] = []
function makeStore() {
  const d = mkdtempSync(join(tmpdir(), 'prov-codex-')); dirs.push(d)
  return makeProviderStore(join(d, 'providers.json'), fakeSecrets, makeAuthSourceStore(join(d, 'auth.json')), { get: () => undefined })
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('resolveActiveCreds · codex 自定义 Provider 携带 codex 扩展（name+wireApi）', () => {
  it('codex provider 激活 → 返回 codex 扩展（providerName/baseUrl/wireApi），顶层 baseUrl 缺省（base_url 走 -c，不进 OPENAI_BASE_URL）', () => {
    const store = makeStore()
    const p = store.create({ engine: 'codex', name: 'foxapi', baseUrl: 'https://api.foxapi.cc/v1', apiKey: 'sk-fox', keyEnv: 'api_key', wireApi: 'responses', models: [{ value: 'gpt-5.5', label: 'GPT-5.5' }], defaultModel: 'gpt-5.5' })
    store.setActive('codex', p.id)
    const creds = store.resolveActiveCreds('codex')
    expect(creds).toEqual({
      baseUrl: undefined,
      apiKey: 'sk-fox',
      keyEnv: 'api_key',
      codex: { providerName: 'foxapi', baseUrl: 'https://api.foxapi.cc/v1', wireApi: 'responses' },
    })
  })

  it('codex provider 经密钥库引用 → key 解析真实值，仍带 codex 扩展', () => {
    const store = makeStore()
    const p = store.create({ engine: 'codex', name: 'gw', baseUrl: 'https://gw.x/v1', apiKeySecretId: 'k_1', keyEnv: 'api_key', wireApi: 'chat', models: [], defaultModel: undefined })
    store.setActive('codex', p.id)
    const creds = store.resolveActiveCreds('codex')
    expect(creds?.apiKey).toBe('sk-real')
    expect(creds?.codex).toEqual({ providerName: 'gw', baseUrl: 'https://gw.x/v1', wireApi: 'chat' })
    expect(creds?.baseUrl).toBeUndefined()
  })

  it('wireApi 缺省回落 responses（与 toView 默认一致）', () => {
    const store = makeStore()
    // 不传 wireApi → CreateProviderReq 默认 responses
    const p = store.create({ engine: 'codex', name: 'p', baseUrl: 'https://b/v1', apiKey: 'k', keyEnv: 'api_key', models: [] })
    store.setActive('codex', p.id)
    expect(store.resolveActiveCreds('codex')?.codex?.wireApi).toBe('responses')
  })

  it('claude provider 不带 codex 扩展（env-only 路径不变）', () => {
    const store = makeStore()
    const p = store.create({ engine: 'claude', name: 'c', baseUrl: 'https://api.c/v1', apiKey: 'sk-c', keyEnv: 'auth_token', models: [] })
    store.setActive('claude', p.id)
    const creds = store.resolveActiveCreds('claude')
    expect(creds).toEqual({ baseUrl: 'https://api.c/v1', apiKey: 'sk-c', keyEnv: 'auth_token' })
    expect(creds && 'codex' in creds).toBe(false)
  })
})
