import type { AuthStrategy, ProviderCreds } from './types'
import type { ActiveProxy } from '../proxy/resolveProxy'

/** env 净化：默认剥除继承的凭证变量（含 altKeyEnv）回落引擎自身登录；有 key 即写回 key（官网来源走官方端点、无 base_url），仅当传入自定义 base_url 才另写 base URL。
 *  extraEnv（技能密钥）在最前合入；其后的 auth 删除/写入对同名 auth 变量有最终决定权，保证引擎登录态不被技能 env 污染。
 *  proxy 三态（镜像 auth 变量「先删继承再按需写」的模式，但 cli-login 例外为继承）：
 *    - managed:true + url   → 先删 HTTPS/HTTP/ALL_PROXY 再写 url（受管代理）。
 *    - managed:true 无 url   → 删三件套，让「直连」真直连（不泄漏 daemon 的 ambient 代理）。
 *    - managed:false / 省略  → 不动继承的代理变量（cli-login 继承本机 ambient，spec §6.5）。 */
export function sanitizeEnv(
  auth: AuthStrategy,
  baseEnv: NodeJS.ProcessEnv,
  creds?: ProviderCreds,
  extraEnv?: Record<string, string>,
  proxy?: ActiveProxy,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...baseEnv }
  if (extraEnv) for (const [k, v] of Object.entries(extraEnv)) env[k] = v
  delete env[auth.apiKeyEnv]
  delete env[auth.baseUrlEnv]
  if (auth.altKeyEnv) delete env[auth.altKeyEnv]
  if (creds?.apiKey) {
    const target = creds.keyEnv === 'auth_token' && auth.altKeyEnv ? auth.altKeyEnv : auth.apiKeyEnv
    env[target] = creds.apiKey
  }
  if (creds?.baseUrl) env[auth.baseUrlEnv] = creds.baseUrl
  if (proxy?.managed) {
    delete env.HTTPS_PROXY; delete env.HTTP_PROXY; delete env.ALL_PROXY
    if (proxy.url) { env.HTTPS_PROXY = proxy.url; env.HTTP_PROXY = proxy.url; env.ALL_PROXY = proxy.url }
  }
  // proxy undefined 或 managed:false → 不动继承的代理变量（cli-login 继承 ambient）
  return env
}
