import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'
import { makeProviderStore } from '../../providers/store'
import { makeAuthSourceStore } from '../../auth/sourceStore'
import { makeOAuthTokenStore } from '../../auth/oauthTokenStore'

let server: DaemonServer | null = null
afterEach(async () => { if (server) await server.close(); server = null })

const fakeSecrets = { getValue: () => undefined }
// providers + authSources + oauthTokens 共享同一临时 auth.json（与真实 server.ts 接线一致）
function tmpEnv() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'oauth-'))
  const authStatePath = path.join(d, 'auth.json')
  const oauthTokens = makeOAuthTokenStore(authStatePath)
  const providers = makeProviderStore(path.join(d, 'providers.json'), fakeSecrets, makeAuthSourceStore(authStatePath), oauthTokens)
  return { authStatePath, providers, oauthTokens }
}

// 注入 fetch 桩：换 token 端点恒返回一份合法 token JSON（含 email）
function fakeFetch(): typeof fetch {
  return (async () => ({
    ok: true,
    status: 200,
    json: async () => ({ access_token: 'at_xyz', refresh_token: 'rt_xyz', expires_in: 3600, account: { email_address: 'oauth@e.com' } }),
    text: async () => '',
  })) as unknown as typeof fetch
}

async function start(oauthFetch?: typeof fetch) {
  const { authStatePath, providers, oauthTokens } = tmpEnv()
  server = await startDaemon({
    detect: () => ({ claude: '/x', codex: '/x' }),
    db: openDatabase(':memory:'),
    providers, authStatePath,
    claudeLogin: () => ({ status: 'signed-out' }),
    oauthFetch: oauthFetch ?? fakeFetch(),
  })
  return { url: server.url, oauthTokens }
}
const J = { 'content-type': 'application/json' }

describe('auth OAuth routes', () => {
  it('start → finish 走通：返回授权 URL + state，换 token 后回 email，token 入库', async () => {
    const { url, oauthTokens } = await start()
    // start
    const sres = await fetch(url + '/auth/oauth/start', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude' }) })
    expect(sres.status).toBe(200)
    const sbody = await sres.json() as { authorizeUrl: string; state: string }
    expect(sbody.authorizeUrl).toContain('claude.ai/oauth/authorize')
    expect(sbody.state).toBeTruthy()
    // finish
    const fres = await fetch(url + '/auth/oauth/finish', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', code: 'thecode', state: sbody.state }) })
    expect(fres.status).toBe(200)
    const fbody = await fres.json() as { email?: string }
    expect(fbody.email).toBe('oauth@e.com')
    // token 入库
    const rec = oauthTokens.get('claude')
    expect(rec?.accessToken).toBe('at_xyz')
    expect(rec?.email).toBe('oauth@e.com')
    // GET /auth/status 反映已登录（持久化态，跨重开保留的真相来源）
    const st = await (await fetch(url + '/auth/status')).json() as { engines: { claude: { oauth: { signedIn: boolean; email?: string } } } }
    expect(st.engines.claude.oauth.signedIn).toBe(true)
    expect(st.engines.claude.oauth.email).toBe('oauth@e.com')
  })

  it('finish 用已消费（删除）的 state 重放 → 400 会话失效', async () => {
    const { url } = await start()
    const sbody = await (await fetch(url + '/auth/oauth/start', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude' }) })).json() as { state: string }
    await fetch(url + '/auth/oauth/finish', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', code: 'c', state: sbody.state }) })
    // 同 state 再来一次：stash 已 delete → 400
    const again = await fetch(url + '/auth/oauth/finish', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', code: 'c', state: sbody.state }) })
    expect(again.status).toBe(400)
  })

  it('finish 用未知 state → 400', async () => {
    const { url } = await start()
    const res = await fetch(url + '/auth/oauth/finish', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', code: 'c', state: 'nope' }) })
    expect(res.status).toBe(400)
  })

  it('finish 的 engine 与 stash 的 engine 不一致 → 400', async () => {
    const { url } = await start()
    const sbody = await (await fetch(url + '/auth/oauth/start', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude' }) })).json() as { state: string }
    const res = await fetch(url + '/auth/oauth/finish', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'codex', code: 'c', state: sbody.state }) })
    expect(res.status).toBe(400)
  })

  it('finish 换 token 失败（fetch 抛/非 ok）→ 502', async () => {
    const failFetch = (async () => ({ ok: false, status: 401, json: async () => ({}), text: async () => 'denied' })) as unknown as typeof fetch
    const { url } = await start(failFetch)
    const sbody = await (await fetch(url + '/auth/oauth/start', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude' }) })).json() as { state: string }
    const res = await fetch(url + '/auth/oauth/finish', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', code: 'c', state: sbody.state }) })
    expect(res.status).toBe(502)
  })

  it('logout → 200，token 清除（oauth.signedIn:false）+ 来源重置回 cli-login', async () => {
    const { url } = await start()
    // 先 start→finish 真换 token 入库 + 切到 oauth 来源
    const sbody = await (await fetch(url + '/auth/oauth/start', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude' }) })).json() as { state: string }
    await fetch(url + '/auth/oauth/finish', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude', code: 'c', state: sbody.state }) })
    await fetch(url + '/auth/source', { method: 'PUT', headers: J, body: JSON.stringify({ engine: 'claude', source: 'oauth' }) })
    // 登出
    const res = await fetch(url + '/auth/logout', { method: 'POST', headers: J, body: JSON.stringify({ engine: 'claude' }) })
    expect(res.status).toBe(200)
    const st = await (await fetch(url + '/auth/status')).json() as { engines: { claude: { activeSource: string; oauth: { signedIn: boolean } } } }
    expect(st.engines.claude.oauth.signedIn).toBe(false)
    expect(st.engines.claude.activeSource).toBe('cli-login')
  })
})
