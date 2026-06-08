import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import { ProviderSection } from '../ProviderSection'
import type { CliLoginStatus } from '../../api/types'

const api = {
  listProviders: vi.fn(),
  listSecrets: vi.fn(),
  getConfig: vi.fn(),
  getAuthStatus: vi.fn(),
  setAuthSource: vi.fn(),
  setOfficialKey: vi.fn(),
  createSecret: vi.fn(),
  setActiveProvider: vi.fn(),
  listProxies: vi.fn().mockResolvedValue({ proxies: [] }),
  setSourceProxy: vi.fn().mockResolvedValue({ ok: true }),
}
vi.mock('../../api/client', () => ({ api: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }) }))

// 让 claude 走 cli-login 来源，并注入指定 cliLogin 态（其 extra 就会渲染本机登录态块）
function mockAuth(cliLogin: CliLoginStatus) {
  api.getAuthStatus.mockResolvedValue({
    engines: {
      claude: { activeSource: 'cli-login', officialKey: {}, custom: [], cliLogin, oauth: { signedIn: false }, proxyBindings: {} },
      codex: { activeSource: 'cli-login', officialKey: {}, custom: [], cliLogin: { status: 'unknown' }, oauth: { signedIn: false }, proxyBindings: {} },
    },
  })
}

beforeEach(() => {
  vi.clearAllMocks()
  api.listProviders.mockResolvedValue({ engines: { claude: { active: 'cli-login', providers: [] }, codex: { active: 'cli-login', providers: [] } } })
  api.listSecrets.mockResolvedValue({ secrets: [], usage: {} })
  api.getConfig.mockResolvedValue({ projectsDir: '', skillsDir: '', engineModels: {}, modelAliases: {} })
  api.setAuthSource.mockResolvedValue({ ok: true })
  api.setOfficialKey.mockResolvedValue({ ok: true })
})

describe('ProviderSection · cli-login 三态显示', () => {
  it('signed-out：显示未登录 notice，且无「登出」按钮', async () => {
    mockAuth({ status: 'signed-out' })
    render(<ProviderSection engine="claude" />)
    expect(await screen.findByText(/未登录/)).toBeInTheDocument()
    expect(screen.queryByText('登出')).not.toBeInTheDocument()
  })

  it('signed-in + oauth：显示 email + 「登出」按钮', async () => {
    mockAuth({ status: 'signed-in', method: 'oauth', email: 'z@e.com' })
    render(<ProviderSection engine="claude" />)
    expect(await screen.findByText(/z@e\.com/)).toBeInTheDocument()
    expect(screen.getByText('登出')).toBeInTheDocument()
  })

  it('signed-in + api_key：显示「API Key 方式」，无 email、无「登出」按钮', async () => {
    mockAuth({ status: 'signed-in', method: 'api_key' })
    render(<ProviderSection engine="claude" />)
    expect(await screen.findByText(/API Key 方式/)).toBeInTheDocument()
    expect(screen.queryByText('登出')).not.toBeInTheDocument()
  })
})
