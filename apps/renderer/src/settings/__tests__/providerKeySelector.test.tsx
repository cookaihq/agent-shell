import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ProviderSection } from '../ProviderSection'

const api = { listProviders: vi.fn(), listSecrets: vi.fn(), getConfig: vi.fn(), createProvider: vi.fn(), updateProvider: vi.fn(), setActiveProvider: vi.fn(), createSecret: vi.fn(), getAuthStatus: vi.fn(), setAuthSource: vi.fn(), setOfficialKey: vi.fn(), listProxies: vi.fn().mockResolvedValue({ proxies: [] }), setSourceProxy: vi.fn().mockResolvedValue({ ok: true }) }
vi.mock('../../api/client', () => ({ api: new Proxy({}, { get: (_t, k: string) => (...a: unknown[]) => (api as Record<string, (...x: unknown[]) => unknown>)[k](...a) }) }))

beforeEach(() => {
  vi.clearAllMocks()
  api.listProviders.mockResolvedValue({ engines: { claude: { active: 'default', providers: [] }, codex: { active: 'default', providers: [] } } })
  api.listSecrets.mockResolvedValue({
    secrets: [
      { id: 'k_1', name: '高德 Key', note: '', hasValue: true, maskedValue: '…3d4e', createdAt: 1 },
      { id: 'k_2', name: '公司网关密钥', note: '', hasValue: true, maskedValue: '…abcd', createdAt: 2 },
    ],
    usage: {},
  })
  api.getConfig.mockResolvedValue({ projectsDir: '', skillsDir: '', engineModels: {}, modelAliases: {} })
  api.createProvider.mockResolvedValue({ provider: { id: 'p_1' } })
  api.setActiveProvider.mockResolvedValue({ ok: true })
  api.getAuthStatus.mockResolvedValue({ engines: {
    claude: { activeSource: 'cli-login', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: {} },
    codex: { activeSource: 'cli-login', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: {} },
  } })
  api.setAuthSource.mockResolvedValue({ ok: true })
  api.setOfficialKey.mockResolvedValue({ ok: true })
})

describe('ProviderSection · API Key 密钥选择器', () => {
  it('打开添加表单 → 渲染密钥下拉（含已有密钥 + 手动新建项），无裸密钥输入框', async () => {
    render(<ProviderSection engine="claude" />)
    await userEvent.click(await screen.findByText(/添加 Provider/))
    const select = (await screen.findByRole('option', { name: '选择密钥…' })).closest('select') as HTMLSelectElement
    // 两个已有密钥名 + 手动新建项作为选项
    expect(within(select).getByRole('option', { name: '高德 Key' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: '公司网关密钥' })).toBeInTheDocument()
    expect(within(select).getByRole('option', { name: /手动输入新密钥/ })).toBeInTheDocument()
    // 默认（非新建）态下不应有旧的裸密钥密码框
    expect(screen.queryByPlaceholderText(/填写该 Provider 的密钥/)).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText(/留空表示不修改/)).not.toBeInTheDocument()
  })

  it('选「手动输入新密钥」→ 显示名称 + 值输入；保存时先建密钥再以 apiKeySecretId 建 Provider', async () => {
    render(<ProviderSection engine="claude" />)
    await userEvent.click(await screen.findByText(/添加 Provider/))
    const select = (await screen.findByRole('option', { name: '选择密钥…' })).closest('select') as HTMLSelectElement
    await userEvent.selectOptions(select, '__new__')
    const nameInput = await screen.findByPlaceholderText(/密钥名称/)
    const valInput = await screen.findByPlaceholderText(/粘贴密钥|Token/)
    await userEvent.type(nameInput, '新中转密钥')
    await userEvent.type(valInput, 'sk-xyz')
    api.createSecret = vi.fn().mockResolvedValue({ secret: { id: 'k_new', name: '新中转密钥', note: '', hasValue: true, maskedValue: '…-xyz', createdAt: 3 } })
    // 填名称 + Base URL 以通过保存校验
    await userEvent.type(screen.getByPlaceholderText(/我的中转站|公司网关/), '我的中转')
    await userEvent.type(screen.getByPlaceholderText(/api\.example\.com/), 'https://api.example.com')
    await userEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(api.createSecret).toHaveBeenCalledWith(expect.objectContaining({ name: '新中转密钥', value: 'sk-xyz' })))
    await waitFor(() => expect(api.createProvider).toHaveBeenCalledWith(expect.objectContaining({ engine: 'claude', apiKeySecretId: 'k_new' })))
  })

  it('选已有密钥 → 保存时以该 secretId 作为 apiKeySecretId', async () => {
    render(<ProviderSection engine="claude" />)
    await userEvent.click(await screen.findByText(/添加 Provider/))
    const select = (await screen.findByRole('option', { name: '选择密钥…' })).closest('select') as HTMLSelectElement
    await userEvent.selectOptions(select, 'k_2')
    await userEvent.type(screen.getByPlaceholderText(/我的中转站|公司网关/), '我的中转')
    await userEvent.type(screen.getByPlaceholderText(/api\.example\.com/), 'https://api.example.com')
    await userEvent.click(screen.getByText('保存'))
    await waitFor(() => expect(api.createProvider).toHaveBeenCalledWith(expect.objectContaining({ apiKeySecretId: 'k_2' })))
  })
})
