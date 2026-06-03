import type { AuthStrategy, ProviderCreds } from './types'

/** env 净化（MVP §B2）：默认剥除继承的凭证变量回落 OAuth；仅当传入自定义 base_url 才写回 base URL + key。 */
export function sanitizeEnv(
  auth: AuthStrategy,
  baseEnv: NodeJS.ProcessEnv,
  creds?: ProviderCreds,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  // 默认剥除：防 API key 计费盖掉 OAuth 登录态
  delete env[auth.apiKeyEnv]
  delete env[auth.baseUrlEnv]
  // 仅"有自定义 base_url 才留 key"
  if (creds?.baseUrl) {
    env[auth.baseUrlEnv] = creds.baseUrl
    if (creds.apiKey) env[auth.apiKeyEnv] = creds.apiKey
  }
  return env
}
