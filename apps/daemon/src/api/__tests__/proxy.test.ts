import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'
import { makeProviderStore } from '../../providers/store'
import { makeAuthSourceStore } from '../../auth/sourceStore'

let server: DaemonServer | null = null
afterEach(async () => { if (server) await server.close(); server = null })

const fakeSecrets = { getValue: () => undefined }
function tmpEnv() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'proxy-'))
  const authStatePath = path.join(d, 'auth.json')
  const proxiesPath = path.join(d, 'proxies.json')
  const providers = makeProviderStore(path.join(d, 'providers.json'), fakeSecrets, makeAuthSourceStore(authStatePath), { get: () => undefined })
  return { authStatePath, proxiesPath, providers }
}
async function start() {
  const { authStatePath, proxiesPath, providers } = tmpEnv()
  server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db: openDatabase(':memory:'), providers, authStatePath, proxiesPath, claudeLogin: () => ({ status: 'signed-out' }) })
  return { url: server.url }
}
const J = { 'content-type': 'application/json' }

type ProxyView = { id: string; name: string; protocol: string; host: string; port: number; username?: string; hasPassword: boolean; status?: string; createdAt: number; password?: string }

async function createProxy(url: string, body: Record<string, unknown>) {
  const res = await fetch(url + '/proxies', { method: 'POST', headers: J, body: JSON.stringify(body) })
  return res
}

describe('proxy routes', () => {
  it('POST /proxies 创建（含密码）→ 201；GET /proxies 列出但绝不回明文 password，只回 hasPassword', async () => {
    const { url } = await start()
    const res = await createProxy(url, { name: '香港', protocol: 'socks5', host: '1.2.3.4', port: 1080, username: 'u', password: 'secret' })
    expect(res.status).toBe(201)
    const created = (await res.json()) as { proxy: ProxyView }
    expect(created.proxy.hasPassword).toBe(true)
    expect('password' in created.proxy).toBe(false)

    const { proxies } = (await (await fetch(url + '/proxies')).json()) as { proxies: ProxyView[] }
    expect(proxies).toHaveLength(1)
    const p = proxies[0]
    expect(p.name).toBe('香港')
    expect(p.protocol).toBe('socks5')
    expect(p.hasPassword).toBe(true)
    expect('password' in p).toBe(false)
    expect((p as Record<string, unknown>).password).toBeUndefined()
  })

  it('PUT /proxies/:id 改名生效；DELETE 后消失', async () => {
    const { url } = await start()
    const created = (await (await createProxy(url, { name: 'old', protocol: 'http', host: 'h', port: 8080 })).json()) as { proxy: ProxyView }
    const id = created.proxy.id
    const upd = await fetch(url + '/proxies/' + id, { method: 'PUT', headers: J, body: JSON.stringify({ name: 'new' }) })
    expect(upd.status).toBe(200)
    const updated = (await upd.json()) as { proxy: ProxyView }
    expect(updated.proxy.name).toBe('new')
    expect('password' in updated.proxy).toBe(false)

    const del = await fetch(url + '/proxies/' + id, { method: 'DELETE' })
    expect(del.status).toBe(200)
    const { proxies } = (await (await fetch(url + '/proxies')).json()) as { proxies: ProxyView[] }
    expect(proxies).toHaveLength(0)
  })

  it('PUT /proxies/:id 不存在 → 404', async () => {
    const { url } = await start()
    const res = await fetch(url + '/proxies/px_nope', { method: 'PUT', headers: J, body: JSON.stringify({ name: 'x' }) })
    expect(res.status).toBe(404)
  })

  it('POST /proxies/:id/test 存在 → {ok:true}（mock）；不存在 → 404', async () => {
    const { url } = await start()
    const created = (await (await createProxy(url, { name: 'p', protocol: 'http', host: 'h', port: 8080 })).json()) as { proxy: ProxyView }
    const ok = await fetch(url + '/proxies/' + created.proxy.id + '/test', { method: 'POST' })
    expect(ok.status).toBe(200)
    const r = (await ok.json()) as { ok: boolean }
    expect(r.ok).toBe(true)
    const miss = await fetch(url + '/proxies/px_nope/test', { method: 'POST' })
    expect(miss.status).toBe(404)
  })

  it('PUT /auth/proxy 绑定来源 → /auth/status 反映 proxyBindings；proxyId 空串解绑', async () => {
    const { url } = await start()
    const created = (await (await createProxy(url, { name: 'p', protocol: 'http', host: 'h', port: 8080 })).json()) as { proxy: ProxyView }
    const id = created.proxy.id
    const bind = await fetch(url + '/auth/proxy', { method: 'PUT', headers: J, body: JSON.stringify({ engine: 'claude', source: 'official-key', proxyId: id }) })
    expect(bind.status).toBe(200)
    let st = (await (await fetch(url + '/auth/status')).json()) as { engines: { claude: { proxyBindings: Record<string, string> } } }
    expect(st.engines.claude.proxyBindings['official-key']).toBe(id)

    const clear = await fetch(url + '/auth/proxy', { method: 'PUT', headers: J, body: JSON.stringify({ engine: 'claude', source: 'official-key', proxyId: '' }) })
    expect(clear.status).toBe(200)
    st = (await (await fetch(url + '/auth/status')).json()) as { engines: { claude: { proxyBindings: Record<string, string> } } }
    expect(st.engines.claude.proxyBindings['official-key']).toBeUndefined()
  })

  it('GET /auth/status 默认 proxyBindings 为空对象', async () => {
    const { url } = await start()
    const st = (await (await fetch(url + '/auth/status')).json()) as { engines: { claude: { proxyBindings: Record<string, string> }; codex: { proxyBindings: Record<string, string> } } }
    expect(st.engines.claude.proxyBindings).toEqual({})
    expect(st.engines.codex.proxyBindings).toEqual({})
  })

  it('POST /proxies 缺 host → 400；端口越界 → 400', async () => {
    const { url } = await start()
    const noHost = await createProxy(url, { name: 'p', protocol: 'http', port: 8080 })
    expect(noHost.status).toBe(400)
    const badPort = await createProxy(url, { name: 'p', protocol: 'http', host: 'h', port: 99999 })
    expect(badPort.status).toBe(400)
  })
})
