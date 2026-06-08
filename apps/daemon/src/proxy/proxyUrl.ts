export interface ProxyParts { protocol: string; host: string; port: number; username?: string; password?: string }

/** 构造代理 URL：{protocol}://{user}:{pass}@{host}:{port}。
 *  认证段仅在 username 与 password 同时非空时才输出（对齐 sub2api Proxy.URL()
 *  service/proxy.go 的 `p.Username != "" && p.Password != ""` 门控）——
 *  只有用户名没密码不是合法代理凭证，故省略 userinfo，输出干净的 host:port。
 *  user/pass 经 encodeURIComponent 转义（防特殊字符破坏 URL）。 */
export function buildProxyUrl(p: ProxyParts): string {
  const auth = p.username && p.password
    ? `${encodeURIComponent(p.username)}:${encodeURIComponent(p.password)}@`
    : ''
  return `${p.protocol}://${auth}${p.host}:${p.port}`
}
