import { describe, it, expect } from 'vitest'
import { buildAuthUrl } from '../clone'

describe('buildAuthUrl（多平台私有认证 url）', () => {
  it('github 公开：原样 https', () => {
    expect(buildAuthUrl({ provider: 'github', loc: 'github.com/a/b', private: false } as any))
      .toBe('https://github.com/a/b.git')
  })
  it('cnb 私有：user:token@ 注入', () => {
    expect(buildAuthUrl({ provider: 'cnb', loc: 'cnb.cool/o/r', private: true, user: 'cnb', token: 'eLTz' } as any))
      .toBe('https://cnb:eLTz@cnb.cool/o/r.git')
  })
  it('github 私有用 PAT：x-access-token:token@（user 缺省）', () => {
    expect(buildAuthUrl({ provider: 'github', loc: 'github.com/a/b', private: true, token: 'ghp_x' } as any))
      .toBe('https://x-access-token:ghp_x@github.com/a/b.git')
  })
  it('token 含特殊字符做 url 编码', () => {
    expect(buildAuthUrl({ provider: 'gitee', loc: 'gitee.com/a/b', private: true, user: 'u', token: 'p@ss/w' } as any))
      .toContain('u:p%40ss%2Fw@')
  })
  it('归一化：带 .git 尾斜杠 → 干净 https', () => {
    expect(buildAuthUrl({ loc: 'github.com/a/b.git/', private: false } as any))
      .toBe('https://github.com/a/b.git')
  })
})
