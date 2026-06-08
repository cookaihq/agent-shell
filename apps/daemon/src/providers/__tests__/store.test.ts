import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeProviderStore } from '../store'
import { makeAuthSourceStore } from '../../auth/sourceStore'

let file: string
let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'prov-')); file = path.join(dir, 'providers.json') })
// 这些用例不走密钥库引用，secrets 仅作占位（getValue 恒空）
const secrets = { getValue: () => undefined }
// 凭证来源权威：与 providers 共享临时目录，setActive 会写它，resolveActiveCreds 据它分支
const mk = () => makeProviderStore(file, secrets, makeAuthSourceStore(path.join(dir, 'auth.json')), { get: () => undefined })

describe('ProviderStore wireApi', () => {
  it('create 带 wireApi chat → view.wireApi 为 chat', () => {
    const store = mk()
    const v = store.create({ engine: 'codex', name: 'relay', baseUrl: 'https://x', apiKey: 'k', keyEnv: 'api_key', wireApi: 'chat' })
    expect(v.wireApi).toBe('chat')
    expect(store.view().engines.codex.providers[0].wireApi).toBe('chat')
  })
  it('create 不带 wireApi → 默认 responses', () => {
    const store = mk()
    const v = store.create({ engine: 'codex', name: 'relay', baseUrl: 'https://x', apiKey: 'k', keyEnv: 'api_key' })
    expect(v.wireApi).toBe('responses')
  })
})

describe('ProviderStore models/defaultModel', () => {
  it('create 带 models/defaultModel → view 带出', () => {
    const store = mk()
    const v = store.create({ engine: 'codex', name: 'relay', baseUrl: 'https://x', apiKey: 'k', keyEnv: 'api_key',
      models: [{ value: 'gpt-5.5', label: 'GPT 5.5' }], defaultModel: 'gpt-5.5' })
    expect(v.models).toEqual([{ value: 'gpt-5.5', label: 'GPT 5.5' }])
    expect(v.defaultModel).toBe('gpt-5.5')
    expect(store.view().engines.codex.providers[0].defaultModel).toBe('gpt-5.5')
  })

  it('update 改 models/defaultModel', () => {
    const store = mk()
    const v = store.create({ engine: 'claude', name: 'fox', baseUrl: 'https://x', apiKey: 'k', keyEnv: 'auth_token', models: [], defaultModel: undefined })
    const u = store.update(v.id, { models: [{ value: 'opus', label: 'Opus' }], defaultModel: 'opus' })
    expect(u?.models).toEqual([{ value: 'opus', label: 'Opus' }])
    expect(u?.defaultModel).toBe('opus')
  })

  it('create 不带 models → 默认空数组', () => {
    const store = mk()
    const v = store.create({ engine: 'claude', name: 'x', baseUrl: 'b', apiKey: 'k', keyEnv: 'api_key', models: [], defaultModel: undefined })
    expect(v.models).toEqual([])
    expect(v.defaultModel).toBeUndefined()
  })
})

describe('providerStore', () => {
  it('空文件 → 每引擎 default、空列表', () => {
    const s = mk()
    expect(s.view().engines.claude).toEqual({ active: 'default', providers: [] })
  })
  it('create 返回掩码视图（不含明文 key）+ 落盘 0600', () => {
    const s = mk()
    const v = s.create({ engine: 'claude', name: '中转', baseUrl: 'https://x', apiKey: 'sk-abcdef1234', keyEnv: 'auth_token' })
    expect(v.hasKey).toBe(true)
    expect(v.maskedKey).toBe('sk-…1234')
    expect((v as Record<string, unknown>).apiKey).toBeUndefined()
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })
  it('setActive + resolveActiveCreds 返回明文 creds（仅 daemon 内部用）', () => {
    const s = mk()
    const v = s.create({ engine: 'claude', name: '中转', baseUrl: 'https://x', apiKey: 'sk-1', keyEnv: 'auth_token' })
    s.setActive('claude', v.id)
    expect(s.resolveActiveCreds('claude')).toEqual({ baseUrl: 'https://x', apiKey: 'sk-1', keyEnv: 'auth_token' })
  })
  it('active=default → resolveActiveCreds 返回 undefined（不注入）', () => {
    const s = mk()
    expect(s.resolveActiveCreds('claude')).toBeUndefined()
  })
  it('update 省略 apiKey → 保留原 key；remove 当前项 → 回落 default', () => {
    const s = mk()
    const v = s.create({ engine: 'claude', name: 'a', baseUrl: 'https://x', apiKey: 'sk-1', keyEnv: 'api_key' })
    s.setActive('claude', v.id)
    s.update(v.id, { name: 'b' })                       // 不传 apiKey
    expect(s.resolveActiveCreds('claude')!.apiKey).toBe('sk-1')
    s.remove(v.id)
    expect(s.view().engines.claude.active).toBe('default')
  })
  it('setActive 非法 id → no-op（不写入幽灵 active）；可切回 default', () => {
    const s = mk()
    const v = s.create({ engine: 'claude', name: 'a', baseUrl: 'https://x', apiKey: 'sk-1', keyEnv: 'api_key' })
    s.setActive('claude', v.id)
    s.setActive('claude', 'p_ghost')                  // 不存在的 id
    expect(s.view().engines.claude.active).toBe(v.id) // 未被改成幽灵
    s.setActive('claude', 'default')
    expect(s.view().engines.claude.active).toBe('default')
  })
  it('maskKey 永不回传完整 key（短 key 也不全露）', () => {
    const s = mk()
    const v = s.create({ engine: 'claude', name: 'a', baseUrl: 'https://x', apiKey: 'ab', keyEnv: 'api_key' })
    expect(v.maskedKey).toBe('…')
  })
})
