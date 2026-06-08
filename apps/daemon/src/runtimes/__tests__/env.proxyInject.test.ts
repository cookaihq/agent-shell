import { describe, it, expect } from 'vitest'
import { sanitizeEnv } from '../env'
import { CLAUDE_AUTH } from '../claudeSdk'

describe('sanitizeEnv 代理注入（proxy 三态，第 5 参）', () => {
  it('受管 + url → 注入 HTTPS_PROXY / HTTP_PROXY / ALL_PROXY 三件套', () => {
    const env = sanitizeEnv(CLAUDE_AUTH, {}, undefined, undefined, { managed: true, url: 'http://p:8080' })
    expect(env.HTTPS_PROXY).toBe('http://p:8080')
    expect(env.HTTP_PROXY).toBe('http://p:8080')
    expect(env.ALL_PROXY).toBe('http://p:8080')
  })

  it('受管直连（managed:true 无 url）在带 ambient 代理的 baseEnv 上 → 三件套被删（直连真直连，不泄漏 ambient）', () => {
    const base = { HTTPS_PROXY: 'http://ambient', HTTP_PROXY: 'http://ambient', ALL_PROXY: 'http://ambient' }
    const env = sanitizeEnv(CLAUDE_AUTH, base, undefined, undefined, { managed: true })
    expect(env.HTTPS_PROXY).toBeUndefined()
    expect(env.HTTP_PROXY).toBeUndefined()
    expect(env.ALL_PROXY).toBeUndefined()
  })

  it('cli-login（managed:false）在带 ambient 代理的 baseEnv 上 → ambient 保留（继承本机配置，spec §6.5）', () => {
    const base = { HTTPS_PROXY: 'http://ambient', HTTP_PROXY: 'http://ambient', ALL_PROXY: 'http://ambient' }
    const env = sanitizeEnv(CLAUDE_AUTH, base, undefined, undefined, { managed: false })
    expect(env.HTTPS_PROXY).toBe('http://ambient')
    expect(env.HTTP_PROXY).toBe('http://ambient')
    expect(env.ALL_PROXY).toBe('http://ambient')
  })

  it('proxy 省略（undefined）在带 ambient 代理的 baseEnv 上 → ambient 保留（不动代理变量）', () => {
    const base = { HTTPS_PROXY: 'http://ambient', HTTP_PROXY: 'http://ambient', ALL_PROXY: 'http://ambient' }
    const env = sanitizeEnv(CLAUDE_AUTH, base, undefined, undefined, undefined)
    expect(env.HTTPS_PROXY).toBe('http://ambient')
    expect(env.HTTP_PROXY).toBe('http://ambient')
    expect(env.ALL_PROXY).toBe('http://ambient')
  })

  it('受管代理与 creds 并存 → key 与代理同时注入（互不影响）', () => {
    const env = sanitizeEnv(CLAUDE_AUTH, {}, { apiKey: 'sk', keyEnv: 'api_key' }, undefined, { managed: true, url: 'socks5://h:1080' })
    expect(env.ANTHROPIC_API_KEY).toBe('sk')
    expect(env.ALL_PROXY).toBe('socks5://h:1080')
  })
})
