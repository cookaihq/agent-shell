import { describe, it, expect, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { makeProviderStore } from '../store'
import { makeAuthSourceStore } from '../../auth/sourceStore'
import { makeOAuthTokenStore } from '../../auth/oauthTokenStore'

const fakeSecrets = { getValue: (_id: string) => undefined }
const dirs: string[] = []
function tmpDir() { const d = mkdtempSync(join(tmpdir(), 'prov-oauth-')); dirs.push(d); return d }
afterEach(() => { for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true }) })

function build() {
  const d = tmpDir()
  const sourceStore = makeAuthSourceStore(join(d, 'auth.json'))
  const oauthTokens = makeOAuthTokenStore(join(d, 'auth.json'))
  const store = makeProviderStore(join(d, 'providers.json'), fakeSecrets, sourceStore, oauthTokens)
  return { store, sourceStore, oauthTokens }
}

describe("resolveActiveCreds activeSource='oauth'", () => {
  it('有 token → 注入 access_token 走 ANTHROPIC_AUTH_TOKEN（无 base_url，keyEnv=auth_token）', () => {
    const { store, sourceStore, oauthTokens } = build()
    sourceStore.setSource('claude', 'oauth')
    oauthTokens.set('claude', { accessToken: 'sk-ant-oat-x', expiresAt: Date.now() + 1e6 })
    expect(store.resolveActiveCreds('claude')).toEqual({ baseUrl: undefined, apiKey: 'sk-ant-oat-x', keyEnv: 'auth_token' })
  })

  it('activeSource=oauth 但无 token → undefined', () => {
    const { store, sourceStore } = build()
    sourceStore.setSource('claude', 'oauth')
    expect(store.resolveActiveCreds('claude')).toBeUndefined()
  })
})
