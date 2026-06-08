// Claude 订阅 OAuth 纯函数（PKCE + 授权 URL + 换 token）
// 常量与流程逐字对照 sub2api：
//   tmp/sub2api/backend/internal/pkg/oauth/oauth.go
//   tmp/sub2api/backend/internal/repository/claude_oauth_service.go
// 本文件只做纯函数 + 注入式 fetch，无路由 / 无 token 存储 / 无真实账号登录。

import { randomBytes, createHash } from 'node:crypto'

// Claude OAuth 常量（对照 sub2api oauth.go，禁止改动任何字符）
export const CLAUDE_OAUTH = {
  clientId: '9d1c250a-e61b-44d9-88ed-5944d1962f5e',
  authorizeUrl: 'https://claude.ai/oauth/authorize',
  tokenUrl: 'https://platform.claude.com/v1/oauth/token',
  redirectUri: 'https://platform.claude.com/oauth/code/callback',
  // 浏览器授权 scope（含 org:create_api_key）
  scope:
    'org:create_api_key user:profile user:inference user:sessions:claude_code user:mcp_servers user:file_upload',
} as const

// n 字节随机 → base64url 无填充（对照 sub2api 的 GenerateRandomBytes + base64URLEncode）
const randomBase64Url = (n = 32): string => randomBytes(n).toString('base64url')

// 生成 PKCE（RFC 7636，S256）
// verifier：32 字节随机 → base64url 无填充（Node 的 'base64url' 已无填充）
// challenge：base64url(sha256(verifier 字符串))，与 sub2api 的 sha256([]byte(verifier)) 一致
export function genPkce(): { verifier: string; challenge: string } {
  const verifier = randomBase64Url(32)
  const challenge = createHash('sha256').update(verifier).digest('base64url')
  return { verifier, challenge }
}

// 生成 state：32 字节随机 → base64url 无填充
export function genState(): string {
  return randomBase64Url(32)
}

// 构造授权 URL（参数顺序与编码精确对照 sub2api BuildAuthorizationURL）
// - redirect_uri：encodeURIComponent（→ https%3A%2F%2F...）
// - scope：encodeURIComponent 后把 %20 还原成 +（空格→+，冒号保持 %3A）
// - challenge / state 已是 URL 安全的 base64url，原样插入
// 必须用模板字符串拼接以保留确切顺序与编码，不用 URLSearchParams。
export function buildAuthorizeUrl(args: { challenge: string; state: string }): string {
  const encodedRedirectUri = encodeURIComponent(CLAUDE_OAUTH.redirectUri)
  const encodedScope = encodeURIComponent(CLAUDE_OAUTH.scope).replace(/%20/g, '+')
  return (
    `${CLAUDE_OAUTH.authorizeUrl}?code=true` +
    `&client_id=${CLAUDE_OAUTH.clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodedRedirectUri}` +
    `&scope=${encodedScope}` +
    `&code_challenge=${args.challenge}` +
    `&code_challenge_method=S256` +
    `&state=${args.state}`
  )
}

export interface OAuthTokens {
  accessToken: string
  refreshToken?: string
  expiresAt: number
  email?: string
}

// token 响应（对照 sub2api oauth.TokenResponse）
interface TokenResponse {
  access_token: string
  token_type?: string
  expires_in: number
  refresh_token?: string
  scope?: string
  organization?: { uuid?: string }
  account?: { uuid?: string; email_address?: string }
}

// 用授权码换 token（JSON POST 到 TokenURL）
// 粘贴的授权码可能是 authCode#state，按第一个 # 拆分（对照 sub2api ExchangeCodeForToken）：
//   优先用 # 后内嵌的 state；否则若传入了 state 参数则用它。
export async function exchangeCode(
  args: { code: string; verifier: string; state?: string },
  deps?: { fetch?: typeof fetch },
): Promise<OAuthTokens> {
  const doFetch = deps?.fetch ?? fetch

  // 按第一个 # 拆分 code / state
  let authCode = args.code
  let codeState = ''
  const idx = args.code.indexOf('#')
  if (idx !== -1) {
    authCode = args.code.slice(0, idx)
    codeState = args.code.slice(idx + 1)
  }

  const body: Record<string, string> = {
    code: authCode,
    grant_type: 'authorization_code',
    client_id: CLAUDE_OAUTH.clientId,
    redirect_uri: CLAUDE_OAUTH.redirectUri,
    code_verifier: args.verifier,
  }
  // 优先内嵌的 #state，其次显式传入的 state（与 sub2api 行为一致）
  if (codeState) {
    body.state = codeState
  } else if (args.state) {
    body.state = args.state
  }

  const resp = await doFetch(CLAUDE_OAUTH.tokenUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json, text/plain, */*',
      // 对照 sub2api：真实 token 端点对非 axios 客户端可能行为不同
      'User-Agent': 'axios/1.13.6',
    },
    body: JSON.stringify(body),
  })

  if (!resp.ok) {
    const text = await resp.text().catch(() => '')
    throw new Error(`Claude OAuth token 换取失败: status ${resp.status}, body: ${text}`)
  }

  const data = (await resp.json()) as TokenResponse
  // 防御畸形响应：缺 access_token 直接抛错，避免存入 expiresAt=NaN 的垃圾 token
  if (!data.access_token) {
    throw new Error('Claude OAuth token response missing access_token')
  }
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    email: data.account?.email_address,
  }
}
