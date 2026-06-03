import { describe, it, expect } from 'vitest'
import { sanitizeEnv } from '../env'
import type { AuthStrategy } from '../types'

const claudeAuth: AuthStrategy = { apiKeyEnv: 'ANTHROPIC_API_KEY', baseUrlEnv: 'ANTHROPIC_BASE_URL' }

describe('sanitizeEnv', () => {
  it('无 creds → 剥除继承的 API key 与 base URL（回落 OAuth 登录态）', () => {
    const base = { PATH: '/usr/bin', ANTHROPIC_API_KEY: 'sk-inherited', ANTHROPIC_BASE_URL: 'https://x' }
    const env = sanitizeEnv(claudeAuth, base)
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.PATH).toBe('/usr/bin')   // 其它变量原样保留
  })

  it('有自定义 base_url → 写回 base URL 与 key（BYOK）', () => {
    const env = sanitizeEnv(claudeAuth, { PATH: '/usr/bin' }, { baseUrl: 'https://relay', apiKey: 'sk-byok' })
    expect(env.ANTHROPIC_BASE_URL).toBe('https://relay')
    expect(env.ANTHROPIC_API_KEY).toBe('sk-byok')
  })

  it('给了 key 但没 base_url → key 仍被剥除（铁律：有 base_url 才留 key）', () => {
    const env = sanitizeEnv(claudeAuth, { ANTHROPIC_API_KEY: 'sk-inherited' }, { apiKey: 'sk-byok' })
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('不修改传入的 baseEnv（返回新对象）', () => {
    const base = { ANTHROPIC_API_KEY: 'sk-x' }
    sanitizeEnv(claudeAuth, base)
    expect(base.ANTHROPIC_API_KEY).toBe('sk-x')
  })
})
