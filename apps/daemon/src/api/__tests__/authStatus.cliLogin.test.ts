import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'
import { makeProviderStore } from '../../providers/store'
import { makeAuthSourceStore } from '../../auth/sourceStore'
import type { ClaudeLoginState } from '../../auth/claudeLoginDetect'
import type { CodexLoginState } from '../../auth/codexLoginDetect'

let server: DaemonServer | null = null
afterEach(async () => { if (server) await server.close(); server = null })

const fakeSecrets = { getValue: () => undefined }
function tmpEnv() {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'auth-cli-'))
  const providers = makeProviderStore(path.join(d, 'providers.json'), fakeSecrets, makeAuthSourceStore(path.join(d, 'auth.json')), { get: () => undefined })
  return { authStatePath: path.join(d, 'auth.json'), providers }
}
// 注入假 detector：路由不碰真实 keychain / ~/.codex
async function start(claudeLogin: () => ClaudeLoginState, codexLogin?: () => CodexLoginState) {
  const { authStatePath, providers } = tmpEnv()
  server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), db: openDatabase(':memory:'), providers, authStatePath, claudeLogin, codexLogin })
  return { url: server.url }
}

type CliLogin = { status: string; method?: string; email?: string }
type Status = { engines: { claude: { cliLogin: CliLogin }; codex: { cliLogin: CliLogin } } }

describe('GET /auth/status 合入 cli-login 检测', () => {
  it('claude oauth（带 email）映射到 cliLogin', async () => {
    const { url } = await start(() => ({ status: 'signed-in', method: 'oauth', email: 'a@b.com' }))
    const st = await (await fetch(url + '/auth/status')).json() as Status
    expect(st.engines.claude.cliLogin).toEqual({ status: 'signed-in', method: 'oauth', email: 'a@b.com' })
  })

  it('claude api_key 映射到 cliLogin（无 email）', async () => {
    const { url } = await start(() => ({ status: 'signed-in', method: 'api_key' }))
    const st = await (await fetch(url + '/auth/status')).json() as Status
    expect(st.engines.claude.cliLogin).toEqual({ status: 'signed-in', method: 'api_key' })
    expect(st.engines.claude.cliLogin.email).toBeUndefined()
  })

  it('claude signed-out 映射到 cliLogin', async () => {
    const { url } = await start(() => ({ status: 'signed-out' }))
    const st = await (await fetch(url + '/auth/status')).json() as Status
    expect(st.engines.claude.cliLogin).toEqual({ status: 'signed-out' })
  })

  it('codex apikey 登录态映射到 cliLogin（Part A P7：不再恒 unknown）', async () => {
    const { url } = await start(
      () => ({ status: 'signed-out' }),
      () => ({ status: 'signed-in', method: 'api_key' }),
    )
    const st = await (await fetch(url + '/auth/status')).json() as Status
    expect(st.engines.codex.cliLogin).toEqual({ status: 'signed-in', method: 'api_key' })
  })

  it('codex chatgpt OAuth（带 email）映射到 cliLogin', async () => {
    const { url } = await start(
      () => ({ status: 'signed-out' }),
      () => ({ status: 'signed-in', method: 'oauth', email: 'codex@openai.com' }),
    )
    const st = await (await fetch(url + '/auth/status')).json() as Status
    expect(st.engines.codex.cliLogin).toEqual({ status: 'signed-in', method: 'oauth', email: 'codex@openai.com' })
  })

  it('codex 未登录映射到 cliLogin', async () => {
    const { url } = await start(
      () => ({ status: 'signed-out' }),
      () => ({ status: 'signed-out' }),
    )
    const st = await (await fetch(url + '/auth/status')).json() as Status
    expect(st.engines.codex.cliLogin).toEqual({ status: 'signed-out' })
  })

  it('codex 与 claude 各走各的 detector，互不串台', async () => {
    const { url } = await start(
      () => ({ status: 'signed-in', method: 'oauth', email: 'claude@a.com' }),
      () => ({ status: 'signed-in', method: 'api_key' }),
    )
    const st = await (await fetch(url + '/auth/status')).json() as Status
    expect(st.engines.claude.cliLogin).toEqual({ status: 'signed-in', method: 'oauth', email: 'claude@a.com' })
    expect(st.engines.codex.cliLogin).toEqual({ status: 'signed-in', method: 'api_key' })
  })
})
