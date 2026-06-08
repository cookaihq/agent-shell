import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeOAuthTokenStore } from '../oauthTokenStore'
import { makeAuthSourceStore } from '../sourceStore'

const dirs: string[] = []
function tmpFile() {
  const d = mkdtempSync(join(tmpdir(), 'oauth-tok-'))
  dirs.push(d)
  return join(d, 'auth.json')
}
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

describe('oauthTokenStore set/get/clear 往返', () => {
  it('set 后 get 取回同一条记录', () => {
    const file = tmpFile()
    const store = makeOAuthTokenStore(file)
    expect(store.get('claude')).toBeUndefined()
    store.set('claude', { accessToken: 'tok', refreshToken: 'rt', expiresAt: 123, email: 'a@b.c' })
    expect(store.get('claude')).toEqual({ accessToken: 'tok', refreshToken: 'rt', expiresAt: 123, email: 'a@b.c' })
  })

  it('clear 后 get 为 undefined', () => {
    const file = tmpFile()
    const store = makeOAuthTokenStore(file)
    store.set('claude', { accessToken: 'tok', expiresAt: 123 })
    store.clear('claude')
    expect(store.get('claude')).toBeUndefined()
  })

  it('跨实例持久化：新实例仍读得到', () => {
    const file = tmpFile()
    makeOAuthTokenStore(file).set('claude', { accessToken: 'tok', expiresAt: 123 })
    expect(makeOAuthTokenStore(file).get('claude')?.accessToken).toBe('tok')
  })

  it('多引擎互不干扰：set claude 不影响 codex', () => {
    const file = tmpFile()
    const store = makeOAuthTokenStore(file)
    store.set('claude', { accessToken: 'tc', expiresAt: 1 })
    expect(store.get('codex')).toBeUndefined()
  })
})

describe('共享 auth.json：oauthTokenStore 与 sourceStore 互不覆盖', () => {
  it('先 setSource oauth，再写 token：activeSource 与 token 都存活', () => {
    const file = tmpFile()
    const sourceStore = makeAuthSourceStore(file)
    sourceStore.setSource('claude', 'oauth')
    makeOAuthTokenStore(file).set('claude', { accessToken: 'tok', expiresAt: 123 })
    // sourceStore 仍读到 oauth（token 写入没把 activeSource 覆盖回默认）
    expect(makeAuthSourceStore(file).get('claude').activeSource).toBe('oauth')
    expect(makeOAuthTokenStore(file).get('claude')?.accessToken).toBe('tok')
  })

  it('先写 token，再 setSource oauth：token 与 activeSource 都存活', () => {
    const file = tmpFile()
    makeOAuthTokenStore(file).set('claude', { accessToken: 'tok', expiresAt: 123 })
    makeAuthSourceStore(file).setSource('claude', 'oauth')
    // setSource 写入没把 oauth token 抹掉
    expect(makeOAuthTokenStore(file).get('claude')?.accessToken).toBe('tok')
    expect(makeAuthSourceStore(file).get('claude').activeSource).toBe('oauth')
  })

  it('clear token 不动 activeSource', () => {
    const file = tmpFile()
    const sourceStore = makeAuthSourceStore(file)
    sourceStore.setSource('claude', 'oauth')
    const tokStore = makeOAuthTokenStore(file)
    tokStore.set('claude', { accessToken: 'tok', expiresAt: 123 })
    tokStore.clear('claude')
    expect(makeAuthSourceStore(file).get('claude').activeSource).toBe('oauth')
    expect(tokStore.get('claude')).toBeUndefined()
  })
})
