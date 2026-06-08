import { describe, it, expect } from 'vitest'
import { sanitizeEnv } from '../env'
import { CLAUDE_AUTH } from '../claudeSdk'

describe('sanitizeEnv 官方来源注入（key 无需 base_url）', () => {
  it("creds {apiKey, keyEnv:'api_key'} 无 baseUrl → 注入 ANTHROPIC_API_KEY，不写 base_url", () => {
    const env = sanitizeEnv(CLAUDE_AUTH, {}, { apiKey: 'sk', keyEnv: 'api_key' })
    expect(env.ANTHROPIC_API_KEY).toBe('sk')
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })

  it("creds {apiKey, keyEnv:'auth_token'} 无 baseUrl → 注入 ANTHROPIC_AUTH_TOKEN，不写 base_url / api_key", () => {
    const env = sanitizeEnv(CLAUDE_AUTH, {}, { apiKey: 'tok', keyEnv: 'auth_token' })
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe('tok')
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
  })

  it('creds undefined → 三个变量都不注入', () => {
    const env = sanitizeEnv(CLAUDE_AUTH, {})
    expect(env.ANTHROPIC_API_KEY).toBeUndefined()
    expect(env.ANTHROPIC_AUTH_TOKEN).toBeUndefined()
    expect(env.ANTHROPIC_BASE_URL).toBeUndefined()
  })

  it('creds 带 baseUrl（自定义 provider）→ key + base_url 都注入（回归）', () => {
    const env = sanitizeEnv(CLAUDE_AUTH, {}, { apiKey: 'k', keyEnv: 'api_key', baseUrl: 'https://x' })
    expect(env.ANTHROPIC_API_KEY).toBe('k')
    expect(env.ANTHROPIC_BASE_URL).toBe('https://x')
  })
})
