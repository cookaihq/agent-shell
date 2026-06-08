import { describe, it, expect } from 'vitest'
import { buildProxyUrl } from '../proxyUrl'

describe('buildProxyUrl', () => {
  it('带认证：user/pass 经 encodeURIComponent 转义（特殊字符）', () => {
    expect(buildProxyUrl({ protocol: 'http', host: 'p.local', port: 8080, username: 'u', password: 'p@ss' }))
      .toBe('http://u:p%40ss@p.local:8080')
  })
  it('无认证：省略认证段', () => {
    expect(buildProxyUrl({ protocol: 'socks5', host: 'h', port: 1080 }))
      .toBe('socks5://h:1080')
  })
  it('有 username 无 password：省略整个认证段（对齐 sub2api 两者非空门控）', () => {
    expect(buildProxyUrl({ protocol: 'http', host: 'h', port: 80, username: 'u' }))
      .toBe('http://h:80')
  })
})
