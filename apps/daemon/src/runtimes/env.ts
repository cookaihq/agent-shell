import type { AuthStrategy, ProviderCreds } from './types'

/** env 净化：默认剥除继承的凭证变量（含 altKeyEnv）回落引擎自身登录；
 *  仅当传入自定义 base_url 才写回 base URL + key（key 按 keyEnv 选目标变量）。 */
export function sanitizeEnv(
  auth: AuthStrategy,
  baseEnv: NodeJS.ProcessEnv,
  creds?: ProviderCreds,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  delete env[auth.apiKeyEnv]
  delete env[auth.baseUrlEnv]
  if (auth.altKeyEnv) delete env[auth.altKeyEnv]
  if (creds?.baseUrl) {
    env[auth.baseUrlEnv] = creds.baseUrl
    if (creds.apiKey) {
      const target = creds.keyEnv === 'auth_token' && auth.altKeyEnv ? auth.altKeyEnv : auth.apiKeyEnv
      env[target] = creds.apiKey
    }
  }
  return env
}
