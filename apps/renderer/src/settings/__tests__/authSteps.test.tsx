import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderSection } from '../ProviderSection'

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
  startOAuth: vi.fn(),
  finishOAuth: vi.fn(),
  logout: vi.fn(),
}
vi.mock('../../api/client', () => ({ api: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }) }))

beforeEach(() => {
  vi.clearAllMocks()
  // claude 已选 oauth 来源、尚未授权（oauth.signedIn:false）→ 该选项展开，渲染 3 步流程
  api.getAuthStatus.mockResolvedValue({
    engines: {
      claude: { activeSource: 'oauth', officialKey: {}, custom: [], cliLogin: { status: 'signed-out' }, oauth: { signedIn: false }, proxyBindings: {} },
      codex: { activeSource: 'cli-login', officialKey: {}, custom: [], cliLogin: { status: 'unknown' }, oauth: { signedIn: false }, proxyBindings: {} },
    },
  })
  api.listProviders.mockResolvedValue({ engines: { claude: { active: 'oauth', providers: [] }, codex: { active: 'cli-login', providers: [] } } })
  api.listSecrets.mockResolvedValue({ secrets: [], usage: {} })
  api.getConfig.mockResolvedValue({ projectsDir: '', skillsDir: '', engineModels: {}, modelAliases: {} })
  api.setAuthSource.mockResolvedValue({ ok: true })
  api.startOAuth.mockResolvedValue({ authorizeUrl: 'https://claude.ai/oauth/authorize?x=1', state: 'st_1' })
  api.finishOAuth.mockResolvedValue({ email: 'oauth@e.com' })
  api.logout.mockResolvedValue({ ok: true })
})

describe('ProviderSection · oauth 3 步粘码流程（claude）', () => {
  it('选中 oauth：渲染 3 步流程', async () => {
    render(<ProviderSection engine="claude" />)
    expect(await screen.findByRole('button', { name: '生成授权 URL' })).toBeInTheDocument()
  })

  it('点「生成授权 URL」调 startOAuth 并渲染出 URL', async () => {
    render(<ProviderSection engine="claude" />)
    const btn = await screen.findByRole('button', { name: '生成授权 URL' })
    await userEvent.click(btn)
    await waitFor(() => expect(api.startOAuth).toHaveBeenCalledWith('claude'))
    expect(await screen.findByText(/claude\.ai\/oauth\/authorize/)).toBeInTheDocument()
  })

  it('粘授权码 + 确认 → 调 finishOAuth(code,state)，成功后显示 email', async () => {
    render(<ProviderSection engine="claude" />)
    await userEvent.click(await screen.findByRole('button', { name: '生成授权 URL' }))
    await waitFor(() => expect(api.startOAuth).toHaveBeenCalled())
    // finish 后 confirmOAuth 会 reloadAuth() 拉服务端真值——模拟服务端此时已登录（token 入库）
    api.getAuthStatus.mockResolvedValue({
      engines: {
        claude: { activeSource: 'oauth', officialKey: {}, custom: [], cliLogin: { status: 'signed-out' }, oauth: { signedIn: true, email: 'oauth@e.com' }, proxyBindings: {} },
        codex: { activeSource: 'cli-login', officialKey: {}, custom: [], cliLogin: { status: 'unknown' }, oauth: { signedIn: false }, proxyBindings: {} },
      },
    })
    const ta = await screen.findByPlaceholderText(/粘贴/)
    await userEvent.type(ta, 'the-auth-code')
    await userEvent.click(screen.getByText(/确认/))
    await waitFor(() => expect(api.finishOAuth).toHaveBeenCalledWith('claude', 'the-auth-code', 'st_1'))
    expect(await screen.findByText(/oauth@e\.com/)).toBeInTheDocument()
  })

  it('重开持久性：getAuthStatus 回 oauth.signedIn:true → 直接显示已登录行（email + 登出），无需走流程', async () => {
    api.getAuthStatus.mockResolvedValue({
      engines: {
        claude: { activeSource: 'oauth', officialKey: {}, custom: [], cliLogin: { status: 'signed-out' }, oauth: { signedIn: true, email: 'z@e.com' }, proxyBindings: {} },
        codex: { activeSource: 'cli-login', officialKey: {}, custom: [], cliLogin: { status: 'unknown' }, oauth: { signedIn: false }, proxyBindings: {} },
      },
    })
    render(<ProviderSection engine="claude" />)
    expect(await screen.findByText(/z@e\.com/)).toBeInTheDocument()
    expect(screen.getByText('登出')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: '生成授权 URL' })).not.toBeInTheDocument()
  })
})
