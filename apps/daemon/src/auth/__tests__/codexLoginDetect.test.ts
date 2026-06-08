import { describe, it, expect } from 'vitest'
import { detectCodexLoginFromFiles } from '../codexLoginDetect'

// 构造一个最小 JWT（header.payload.signature，仅 payload 段被解码取 email）。
function fakeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url')
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.sig`
}

describe('detectCodexLoginFromFiles', () => {
  it('apikey 态（auth.json 仅 OPENAI_API_KEY）→ signed-in + api_key', () => {
    const r = detectCodexLoginFromFiles({
      'auth.json': JSON.stringify({ OPENAI_API_KEY: 'sk-codex-x' }),
    })
    expect(r).toEqual({ status: 'signed-in', method: 'api_key' })
  })

  it('chatgpt OAuth 态（tokens.id_token 带 email 声明）→ signed-in + oauth + email', () => {
    const r = detectCodexLoginFromFiles({
      'auth.json': JSON.stringify({
        OPENAI_API_KEY: null,
        tokens: {
          id_token: fakeJwt({ email: 'me@example.com' }),
          access_token: 'at-x',
          refresh_token: 'rt-x',
          account_id: 'acc-x',
        },
        last_refresh: '2026-06-08T00:00:00Z',
      }),
    })
    expect(r).toEqual({ status: 'signed-in', method: 'oauth', email: 'me@example.com' })
  })

  it('chatgpt OAuth 态但 id_token 无 email 声明 → signed-in + oauth + email undefined（契约允许）', () => {
    const r = detectCodexLoginFromFiles({
      'auth.json': JSON.stringify({
        OPENAI_API_KEY: null,
        tokens: { id_token: fakeJwt({ sub: 'x' }), access_token: 'at', account_id: 'a' },
      }),
    })
    expect(r).toEqual({ status: 'signed-in', method: 'oauth', email: undefined })
  })

  it('chatgpt OAuth 态 id_token 损坏（非合法 JWT）→ 仍 signed-in + oauth，email undefined（检测绝不抛）', () => {
    const r = detectCodexLoginFromFiles({
      'auth.json': JSON.stringify({ tokens: { id_token: 'not-a-jwt', access_token: 'at' } }),
    })
    expect(r).toEqual({ status: 'signed-in', method: 'oauth', email: undefined })
  })

  it('无 auth.json → signed-out', () => {
    expect(detectCodexLoginFromFiles({})).toEqual({ status: 'signed-out' })
  })

  it('auth.json JSON 解析失败 → signed-out（检测绝不抛）', () => {
    expect(detectCodexLoginFromFiles({ 'auth.json': 'not-json' })).toEqual({ status: 'signed-out' })
  })

  it('auth.json 既无 tokens 又无 OPENAI_API_KEY（null）→ signed-out', () => {
    expect(
      detectCodexLoginFromFiles({ 'auth.json': JSON.stringify({ OPENAI_API_KEY: null }) }),
    ).toEqual({ status: 'signed-out' })
  })

  it('tokens 优先于 OPENAI_API_KEY：两者并存按 oauth 判（chatgpt 登录态 auth.json 也可能留着旧 key 字段）', () => {
    const r = detectCodexLoginFromFiles({
      'auth.json': JSON.stringify({
        OPENAI_API_KEY: 'sk-stale',
        tokens: { id_token: fakeJwt({ email: 'a@b.com' }), access_token: 'at' },
      }),
    })
    expect(r).toEqual({ status: 'signed-in', method: 'oauth', email: 'a@b.com' })
  })
})
