import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'
import { makeProviderStore } from '../../providers/store'
import { makeAuthSourceStore } from '../../auth/sourceStore'
import type { CodexLoginParams, CodexLoginResult } from '../../auth/codexLogin'

let server: DaemonServer | null = null
afterEach(async () => { if (server) await server.close(); server = null })

const fakeSecrets = { getValue: () => undefined }
function tmpEnv() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-login-'))
  const providers = makeProviderStore(path.join(d, 'providers.json'), fakeSecrets, makeAuthSourceStore(path.join(d, 'auth.json')), { get: () => undefined })
  return { authStatePath: path.join(d, 'auth.json'), providers }
}

// 注入假 codexLogin：apiKey 立即 resolve；chatgpt 先回吐 authUrl，再由测试控制何时 resolve/reject。
function makeFakeLogin() {
  let resolveChat: (() => void) | undefined
  let rejectChat: ((e: Error) => void) | undefined
  const fn = (params: CodexLoginParams, onAuthUrl?: (u: string) => void): Promise<CodexLoginResult> => {
    if (params.type === 'apiKey') return Promise.resolve({ ok: true })
    onAuthUrl?.('https://auth.openai.com/codex')
    return new Promise<CodexLoginResult>((res, rej) => { resolveChat = () => res({ ok: true }); rejectChat = rej })
  }
  return { fn, finishChat: () => resolveChat?.(), failChat: (e: Error) => rejectChat?.(e) }
}

async function start(codexLogin: (p: CodexLoginParams, cb?: (u: string) => void) => Promise<CodexLoginResult>) {
  const { authStatePath, providers } = tmpEnv()
  server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db: openDatabase(':memory:'), providers, authStatePath, codexLoginStart: codexLogin })
  return { url: server.url }
}

describe('POST /auth/codex/login · apiKey 同步成功', () => {
  it('type:apiKey → {done:true}', async () => {
    const fake = makeFakeLogin()
    const { url } = await start(fake.fn)
    const r = await fetch(url + '/auth/codex/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'apiKey', apiKey: 'sk-x' }),
    })
    expect(r.status).toBe(200)
    expect(await r.json()).toEqual({ done: true })
  })

  it('缺 apiKey → 400', async () => {
    const fake = makeFakeLogin()
    const { url } = await start(fake.fn)
    const r = await fetch(url + '/auth/codex/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'apiKey' }),
    })
    expect(r.status).toBe(400)
  })
})

describe('POST /auth/codex/login · chatgpt 异步（authUrl + 轮询）', () => {
  it('type:chatgpt → 返回 authUrl + loginSessionId；轮询 pending→done', async () => {
    const fake = makeFakeLogin()
    const { url } = await start(fake.fn)
    const r = await fetch(url + '/auth/codex/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'chatgpt' }),
    })
    const body = await r.json() as { done: boolean; authUrl?: string; loginSessionId?: string }
    expect(body.done).toBe(false)
    expect(body.authUrl).toBe('https://auth.openai.com/codex')
    expect(typeof body.loginSessionId).toBe('string')

    // 完成前：pending
    const s1 = await (await fetch(url + '/auth/codex/login/' + body.loginSessionId)).json() as { status: string }
    expect(s1.status).toBe('pending')

    // 浏览器授权完成 → 假 login resolve
    fake.finishChat()
    await new Promise((r) => setTimeout(r, 10))
    const s2 = await (await fetch(url + '/auth/codex/login/' + body.loginSessionId)).json() as { status: string }
    expect(s2.status).toBe('done')
  })

  it('chatgpt 授权失败 → 轮询 error 带 message', async () => {
    const fake = makeFakeLogin()
    const { url } = await start(fake.fn)
    const body = await (await fetch(url + '/auth/codex/login', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'chatgpt' }),
    })).json() as { loginSessionId?: string }
    fake.failChat(new Error('用户取消授权'))
    await new Promise((r) => setTimeout(r, 10))
    const s = await (await fetch(url + '/auth/codex/login/' + body.loginSessionId)).json() as { status: string; error?: string }
    expect(s.status).toBe('error')
    expect(s.error).toContain('用户取消授权')
  })

  it('未知 loginSessionId → 404', async () => {
    const fake = makeFakeLogin()
    const { url } = await start(fake.fn)
    const r = await fetch(url + '/auth/codex/login/nope')
    expect(r.status).toBe(404)
  })
})
