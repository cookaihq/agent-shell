import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProviderStore } from '../store'
import { makeAuthSourceStore } from '../../auth/sourceStore'
import { makeOAuthTokenStore } from '../../auth/oauthTokenStore'

// 仅实现 getValue：k_1 → 官网 key，其余 undefined
const fakeSecrets = { getValue: (id: string) => (id === 'k_1' ? 'sk-off' : undefined) }
const dirs: string[] = []
function tmpDir() { const d = mkdtempSync(join(tmpdir(), 'prov-src-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function build() {
  const d = tmpDir()
  const sourceStore = makeAuthSourceStore(join(d, 'auth.json'))
  const store = makeProviderStore(join(d, 'providers.json'), fakeSecrets, sourceStore, makeOAuthTokenStore(join(d, 'auth.json')))
  return { store, sourceStore }
}

describe('resolveActiveCreds 按 activeSource 分支', () => {
  it("activeSource='cli-login'（默认）→ undefined（不注入，用 ~/.claude）", () => {
    const { store } = build()
    expect(store.resolveActiveCreds('claude')).toBeUndefined()
  })

  it("activeSource='official-key' + officialKeySecretId → 注入官网 key（无 base_url，x-api-key 风格）", () => {
    const { store, sourceStore } = build()
    sourceStore.setOfficialKey('claude', 'k_1')
    sourceStore.setSource('claude', 'official-key')
    expect(store.resolveActiveCreds('claude')).toEqual({ baseUrl: undefined, apiKey: 'sk-off', keyEnv: 'api_key' })
  })

  it("activeSource='official-key' 但无 officialKeySecretId → undefined", () => {
    const { store, sourceStore } = build()
    sourceStore.setSource('claude', 'official-key')
    expect(store.resolveActiveCreds('claude')).toBeUndefined()
  })

  it("activeSource='official-key' 但密钥库查无该值 → undefined", () => {
    const { store, sourceStore } = build()
    sourceStore.setOfficialKey('claude', 'k_missing')
    sourceStore.setSource('claude', 'official-key')
    expect(store.resolveActiveCreds('claude')).toBeUndefined()
  })

  it("activeSource='oauth' → undefined（Phase4 前不注入）", () => {
    const { store, sourceStore } = build()
    sourceStore.setSource('claude', 'oauth')
    expect(store.resolveActiveCreds('claude')).toBeUndefined()
  })

  it('setActive(engine, providerId) → 写 sourceStore，resolveActiveCreds 返回该 provider 凭证', () => {
    const { store } = build()
    const p = store.create({ engine: 'claude', name: 'X', baseUrl: 'https://api.x.com', apiKey: 'sk-bare', keyEnv: 'auth_token', models: [], wireApi: 'responses' })
    store.setActive('claude', p.id)
    expect(store.resolveActiveCreds('claude')).toEqual({ baseUrl: 'https://api.x.com', apiKey: 'sk-bare', keyEnv: 'auth_token' })
  })

  it("setActive(engine, 'default') → sourceStore 回 cli-login，resolveActiveCreds undefined", () => {
    const { store } = build()
    const p = store.create({ engine: 'claude', name: 'X', baseUrl: 'https://api.x.com', apiKey: 'sk-bare', keyEnv: 'api_key', models: [], wireApi: 'responses' })
    store.setActive('claude', p.id)
    store.setActive('claude', 'default')
    expect(store.resolveActiveCreds('claude')).toBeUndefined()
  })

  it('remove 当前来源 provider → sourceStore 回 cli-login，resolveActiveCreds undefined（不留死 id）', () => {
    const { store, sourceStore } = build()
    const p = store.create({ engine: 'claude', name: 'X', baseUrl: 'https://api.x.com', apiKey: 'sk-bare', keyEnv: 'api_key', models: [], wireApi: 'responses' })
    store.setActive('claude', p.id)
    store.remove(p.id)
    expect(sourceStore.get('claude').activeSource).toBe('cli-login')
    expect(store.resolveActiveCreds('claude')).toBeUndefined()
  })

  it("remove 非当前来源的 provider → 不动 official-key 来源（勿误伤）", () => {
    const { store, sourceStore } = build()
    const p = store.create({ engine: 'claude', name: 'X', baseUrl: 'https://api.x.com', apiKey: 'sk-bare', keyEnv: 'api_key', models: [], wireApi: 'responses' })
    sourceStore.setOfficialKey('claude', 'k_1')
    sourceStore.setSource('claude', 'official-key')   // 来源是官网 key，不是该 provider
    store.remove(p.id)
    expect(sourceStore.get('claude').activeSource).toBe('official-key')
  })
})
