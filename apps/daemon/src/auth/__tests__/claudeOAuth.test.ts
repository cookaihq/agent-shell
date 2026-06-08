import { describe, it, expect, vi } from 'vitest'
import { createHash } from 'node:crypto'
import { genPkce, genState, buildAuthorizeUrl, exchangeCode, CLAUDE_OAUTH } from '../claudeOAuth'

describe('genPkce', () => {
  it('verifier 是非空 base64url（无 = / + /），challenge = base64url(sha256(verifier))', () => {
    const { verifier, challenge } = genPkce()
    // verifier 非空且为 base64url 字母表（无填充、无 +、/）
    expect(verifier.length).toBeGreaterThan(0)
    expect(verifier).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(verifier).not.toContain('=')
    // challenge 独立重算：sha256(verifier 字符串) → base64url 无填充
    const expected = createHash('sha256').update(verifier).digest('base64url')
    expect(challenge).toBe(expected)
    expect(challenge).not.toContain('=')
    expect(challenge).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})

describe('genState', () => {
  it('返回非空 base64url 无填充', () => {
    const s = genState()
    expect(s.length).toBeGreaterThan(0)
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/)
    expect(s).not.toContain('=')
  })
})

describe('buildAuthorizeUrl', () => {
  it('精确匹配 sub2api 的参数顺序与编码（scope 冒号→%3A 空格→+）', () => {
    const url = buildAuthorizeUrl({ challenge: 'CH', state: 'ST' })
    expect(url).toBe(
      'https://claude.ai/oauth/authorize?code=true&client_id=9d1c250a-e61b-44d9-88ed-5944d1962f5e&response_type=code&redirect_uri=https%3A%2F%2Fplatform.claude.com%2Foauth%2Fcode%2Fcallback&scope=org%3Acreate_api_key+user%3Aprofile+user%3Ainference+user%3Asessions%3Aclaude_code+user%3Amcp_servers+user%3Afile_upload&code_challenge=CH&code_challenge_method=S256&state=ST',
    )
  })
})

describe('exchangeCode', () => {
  it('成功换 token：拆 code#state、POST JSON、映射返回字段', async () => {
    const before = Date.now()
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: 'sk-ant-oat-X',
        refresh_token: 'sk-ant-ort-Y',
        expires_in: 3600,
        account: { email_address: 'z@e.com' },
      }),
    })) as unknown as typeof fetch

    const tokens = await exchangeCode(
      { code: 'theauthcode#thestate', verifier: 'theverifier' },
      { fetch: fetchMock },
    )

    expect(tokens.accessToken).toBe('sk-ant-oat-X')
    expect(tokens.refreshToken).toBe('sk-ant-ort-Y')
    expect(tokens.email).toBe('z@e.com')
    expect(typeof tokens.expiresAt).toBe('number')
    expect(tokens.expiresAt).toBeGreaterThan(Date.now())
    // ≈ now + 3600_000
    expect(tokens.expiresAt).toBeGreaterThanOrEqual(before + 3600_000)
    expect(tokens.expiresAt).toBeLessThanOrEqual(Date.now() + 3600_000)

    // 校验调用：URL / method / content-type / body 内容
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [calledUrl, init] = (fetchMock as unknown as ReturnType<typeof vi.fn>).mock.calls[0]
    expect(calledUrl).toBe(CLAUDE_OAUTH.tokenUrl)
    expect(init.method).toBe('POST')
    expect(init.headers['Content-Type']).toBe('application/json')
    expect(init.headers['User-Agent']).toBe('axios/1.13.6')
    const body = JSON.parse(init.body)
    expect(body.grant_type).toBe('authorization_code')
    expect(body.client_id).toBe(CLAUDE_OAUTH.clientId)
    expect(body.code_verifier).toBe('theverifier')
    // # 拆分：code 在前、state 在后
    expect(body.code).toBe('theauthcode')
    expect(body.state).toBe('thestate')
  })

  it('无 account → email 为 undefined（有 access_token，不触发缺失守卫）', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ access_token: 'sk', expires_in: 3600 }),
    })) as unknown as typeof fetch

    const tokens = await exchangeCode({ code: 'c', verifier: 'v' }, { fetch: fetchMock })
    expect(tokens.accessToken).toBe('sk')
    expect(tokens.email).toBeUndefined()
  })

  it('access_token 缺失 → 抛错（防 NaN expiresAt 垃圾 token）', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ expires_in: 3600 }),
    })) as unknown as typeof fetch

    await expect(
      exchangeCode({ code: 'c', verifier: 'v' }, { fetch: fetchMock }),
    ).rejects.toThrow(/access_token/)
  })

  it('非 2xx 响应抛错（带 status + body）', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 400,
      text: async () => 'bad',
    })) as unknown as typeof fetch

    await expect(
      exchangeCode({ code: 'x', verifier: 'v' }, { fetch: fetchMock }),
    ).rejects.toThrow()
  })
})
