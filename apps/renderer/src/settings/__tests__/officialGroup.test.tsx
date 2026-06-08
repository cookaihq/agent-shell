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
  codexLoginStart: vi.fn().mockResolvedValue({ done: false, authUrl: 'https://x', loginSessionId: 's' }),
  codexLoginStatus: vi.fn().mockResolvedValue({ status: 'pending' }),
}
vi.mock('../../api/client', () => ({ api: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }) }))

beforeEach(() => {
  vi.clearAllMocks()
  api.listProviders.mockResolvedValue({ engines: { claude: { active: 'cli-login', providers: [] }, codex: { active: 'cli-login', providers: [] } } })
  api.listSecrets.mockResolvedValue({
    secrets: [
      { id: 'k_1', name: '高德 Key', note: '', hasValue: true, maskedValue: '…3d4e', createdAt: 1 },
      { id: 'k_2', name: '公司网关密钥', note: '', hasValue: true, maskedValue: '…abcd', createdAt: 2 },
    ],
    usage: {},
  })
  api.getConfig.mockResolvedValue({ projectsDir: '', skillsDir: '', engineModels: {}, modelAliases: {} })
  api.getAuthStatus.mockResolvedValue({
    engines: {
      claude: { activeSource: 'cli-login', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: {} },
      codex: { activeSource: 'cli-login', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: {} },
    },
  })
  api.setAuthSource.mockResolvedValue({ ok: true })
  api.setOfficialKey.mockResolvedValue({ ok: true })
})

describe('ProviderSection · 官方组三选项', () => {
  it('claude：「官方 · Anthropic」下渲染三个官方选项', async () => {
    render(<ProviderSection engine="claude" />)
    expect(await screen.findByText('官方 · Anthropic')).toBeInTheDocument()
    expect(screen.getByText('使用本机 CLI 登录状态')).toBeInTheDocument()
    expect(screen.getByText('授权登录')).toBeInTheDocument()
    expect(screen.getByText('官网 API Key')).toBeInTheDocument()
  })

  it('claude：点「官网 API Key」→ 调 setAuthSource(claude, official-key)', async () => {
    render(<ProviderSection engine="claude" />)
    await userEvent.click(await screen.findByText('官网 API Key'))
    await waitFor(() => expect(api.setAuthSource).toHaveBeenCalledWith('claude', 'official-key'))
  })

  it('codex（P7.4）：授权登录可用、cli-login 可用；官网 API Key 暂禁用（codex 注入语义未验证）', async () => {
    render(<ProviderSection engine="codex" />)
    await screen.findByText('官方 · OpenAI')
    const oauthBtn = screen.getByText('授权登录').closest('button')!
    const keyBtn = screen.getByText('官网 API Key').closest('button')!
    const cliBtn = screen.getByText('使用本机 CLI 登录状态').closest('button')!
    expect(oauthBtn).not.toBeDisabled()   // P7.4：codex 授权登录走 app-server 自管 chatgpt OAuth
    expect(keyBtn).toBeDisabled()
    expect(cliBtn).not.toBeDisabled()
  })

  it('codex：选「授权登录」→ 调 setAuthSource(codex, oauth)', async () => {
    const u = userEvent.setup()
    render(<ProviderSection engine="codex" />)
    await screen.findByText('官方 · OpenAI')
    await u.click(screen.getByText('授权登录'))
    await waitFor(() => expect(api.setAuthSource).toHaveBeenCalledWith('codex', 'oauth'))
  })

  it('codex · oauth 选中：展开 ChatGPT 授权引导（非 claude 粘码流），点按钮调 codexLoginStart', async () => {
    const u = userEvent.setup()
    api.getAuthStatus.mockResolvedValue({
      engines: {
        claude: { activeSource: 'cli-login', officialKey: {}, custom: [], cliLogin: { status: 'signed-out' }, oauth: { signedIn: false }, proxyBindings: {} },
        codex: { activeSource: 'oauth', officialKey: {}, custom: [], cliLogin: { status: 'signed-out' }, oauth: { signedIn: false }, proxyBindings: {} },
      },
    })
    api.codexLoginStart.mockResolvedValue({ done: false, authUrl: 'https://auth.openai.com/x', loginSessionId: 's1' })
    render(<ProviderSection engine="codex" />)
    await screen.findByText('官方 · OpenAI')
    const btn = await screen.findByText('用 ChatGPT 授权登录')
    await u.click(btn)
    await waitFor(() => expect(api.codexLoginStart).toHaveBeenCalledWith({ type: 'chatgpt' }))
  })

  it('claude · official-key 选中：选已有密钥 + 保存 → 调 setOfficialKey', async () => {
    api.getAuthStatus.mockResolvedValue({
      engines: {
        claude: { activeSource: 'official-key', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: {} },
        codex: { activeSource: 'cli-login', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: {} },
      },
    })
    render(<ProviderSection engine="claude" />)
    // 官网 key 选择器（区别于 oauth/official-key 行上的代理下拉）
    const select = (await screen.findByRole('option', { name: /官方 API Key…/ })).closest('select') as HTMLSelectElement
    await userEvent.selectOptions(select, 'k_2')
    await userEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(api.setOfficialKey).toHaveBeenCalledWith('claude', 'k_2'))
  })

  it('claude · 代理绑定：official-key 已绑代理 → 下拉显示该代理；选「直连」→ 调 setSourceProxy(claude, official-key, "")', async () => {
    api.listProxies.mockResolvedValue({ proxies: [{ id: 'px1', name: '主力梯子', protocol: 'socks5', host: '127.0.0.1', port: 7890, hasPassword: false, createdAt: 1 }] })
    api.getAuthStatus.mockResolvedValue({
      engines: {
        claude: { activeSource: 'cli-login', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: { 'official-key': 'px1' } },
        codex: { activeSource: 'cli-login', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: {} },
      },
    })
    render(<ProviderSection engine="claude" />)
    await screen.findByText('官网 API Key')
    // 「主力梯子」出现在 oauth + official-key 两个代理下拉里；只有 official-key 这个被选中（绑定值生效）
    const opts = await screen.findAllByRole('option', { name: '主力梯子' })
    expect(opts.length).toBe(2)
    const boundOpt = opts.find((o) => (o as HTMLOptionElement).selected) as HTMLOptionElement
    expect(boundOpt).toBeTruthy()
    // 在被选中的那个 select 上选「直连」→ 解绑
    const proxySelect = boundOpt.closest('select')!
    await userEvent.selectOptions(proxySelect, '直连')
    await waitFor(() => expect(api.setSourceProxy).toHaveBeenCalledWith('claude', 'official-key', ''))
  })
})
