import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeProviderStore } from '../store'

let file: string
beforeEach(() => { file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'prov-')), 'providers.json') })

describe('providerStore', () => {
  it('空文件 → 每引擎 default、空列表', () => {
    const s = makeProviderStore(file)
    expect(s.view().engines.claude).toEqual({ active: 'default', providers: [] })
  })
  it('create 返回掩码视图（不含明文 key）+ 落盘 0600', () => {
    const s = makeProviderStore(file)
    const v = s.create({ engine: 'claude', name: '中转', baseUrl: 'https://x', apiKey: 'sk-abcdef1234', keyEnv: 'auth_token' })
    expect(v.hasKey).toBe(true)
    expect(v.maskedKey).toBe('sk-…1234')
    expect((v as Record<string, unknown>).apiKey).toBeUndefined()
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })
  it('setActive + resolveActiveCreds 返回明文 creds（仅 daemon 内部用）', () => {
    const s = makeProviderStore(file)
    const v = s.create({ engine: 'claude', name: '中转', baseUrl: 'https://x', apiKey: 'sk-1', keyEnv: 'auth_token' })
    s.setActive('claude', v.id)
    expect(s.resolveActiveCreds('claude')).toEqual({ baseUrl: 'https://x', apiKey: 'sk-1', keyEnv: 'auth_token' })
  })
  it('active=default → resolveActiveCreds 返回 undefined（不注入）', () => {
    const s = makeProviderStore(file)
    expect(s.resolveActiveCreds('claude')).toBeUndefined()
  })
  it('update 省略 apiKey → 保留原 key；remove 当前项 → 回落 default', () => {
    const s = makeProviderStore(file)
    const v = s.create({ engine: 'claude', name: 'a', baseUrl: 'https://x', apiKey: 'sk-1', keyEnv: 'api_key' })
    s.setActive('claude', v.id)
    s.update(v.id, { name: 'b' })                       // 不传 apiKey
    expect(s.resolveActiveCreds('claude')!.apiKey).toBe('sk-1')
    s.remove(v.id)
    expect(s.view().engines.claude.active).toBe('default')
  })
  it('setActive 非法 id → no-op（不写入幽灵 active）；可切回 default', () => {
    const s = makeProviderStore(file)
    const v = s.create({ engine: 'claude', name: 'a', baseUrl: 'https://x', apiKey: 'sk-1', keyEnv: 'api_key' })
    s.setActive('claude', v.id)
    s.setActive('claude', 'p_ghost')                  // 不存在的 id
    expect(s.view().engines.claude.active).toBe(v.id) // 未被改成幽灵
    s.setActive('claude', 'default')
    expect(s.view().engines.claude.active).toBe('default')
  })
  it('maskKey 永不回传完整 key（短 key 也不全露）', () => {
    const s = makeProviderStore(file)
    const v = s.create({ engine: 'claude', name: 'a', baseUrl: 'https://x', apiKey: 'ab', keyEnv: 'api_key' })
    expect(v.maskedKey).toBe('…')
  })
})
