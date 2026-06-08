import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi } from 'vitest'
import { ProviderSection, editModelsReducer } from '../ProviderSection'
import { api } from '../../api/client'

vi.mock('../../api/client', () => ({ api: {
  listProviders: vi.fn().mockResolvedValue({ engines: {
    claude: { active: 'default', providers: [
      { id: 'p1', engine: 'claude', name: 'FoxAPI', baseUrl: 'https://api.foxapi.cc/', keyEnv: 'auth_token', hasKey: true, maskedKey: 'sk-…1234', sortIndex: 0, createdAt: 1, models: [], defaultModel: undefined, wireApi: 'responses' as const },
    ] },
    codex: { active: 'default', providers: [] },
  } }),
  setActiveProvider: vi.fn().mockResolvedValue({ ok: true }),
  testProvider: vi.fn().mockResolvedValue({ ok: true, requestText: 'REQ', responseText: 'Hey there!' }),
  createProvider: vi.fn().mockResolvedValue({ provider: { id: 'p-new', engine: 'claude', name: '新中转', baseUrl: 'https://relay.example.com', keyEnv: 'auth_token', hasKey: true, maskedKey: 'sk-…1234', sortIndex: 1, createdAt: 2, models: [], wireApi: 'responses' } }),
  updateProvider: vi.fn().mockResolvedValue({ provider: { id: 'p1', engine: 'claude', name: 'FoxAPI', baseUrl: 'https://api.foxapi.cc/', keyEnv: 'auth_token', hasKey: true, maskedKey: 'sk-…1234', sortIndex: 0, createdAt: 1, models: [], wireApi: 'responses' } }),
  deleteProvider: vi.fn().mockResolvedValue({ ok: true }),
  getConfig: vi.fn().mockResolvedValue({ projectsDir: '', skillsDir: '', engineModels: { claude: 'sonnet' } }),
  saveConfig: vi.fn().mockResolvedValue({}),
  listSecrets: vi.fn().mockResolvedValue({ secrets: [], usage: {} }),
  createSecret: vi.fn().mockResolvedValue({ secret: { id: 'k-new', name: '新中转', note: '', hasValue: true, maskedValue: '…1234', createdAt: 9 } }),
  // 凭证来源（Task 2.4 官方组）：ProviderSection 挂载时拉取来源状态
  getAuthStatus: vi.fn().mockResolvedValue({ engines: {
    claude: { activeSource: 'cli-login', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: {} },
    codex: { activeSource: 'cli-login', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: {} },
  } }),
  setAuthSource: vi.fn().mockResolvedValue({ ok: true }),
  setOfficialKey: vi.fn().mockResolvedValue({ ok: true }),
  // 代理绑定（Task 5.4）：挂载时拉取代理池
  listProxies: vi.fn().mockResolvedValue({ proxies: [] }),
  setSourceProxy: vi.fn().mockResolvedValue({ ok: true }),
}}))

describe('editModelsReducer（编辑表单模型草稿）', () => {
  const init = { models: [{ value: 'a', label: 'a' }, { value: 'b', label: 'b' }], defaultModel: 'a' }
  it('add：去重追加，首个自动设默认', () => {
    const s = editModelsReducer({ models: [], defaultModel: '' }, { type: 'add', value: 'x' })
    expect(s.models).toEqual([{ value: 'x', label: 'x' }])
    expect(s.defaultModel).toBe('x')
  })
  it('add：已存在不重复', () => {
    expect(editModelsReducer(init, { type: 'add', value: 'a' }).models).toHaveLength(2)
  })
  it('del：删除并在删掉默认时改默认为首项', () => {
    const s = editModelsReducer(init, { type: 'del', value: 'a' })
    expect(s.models).toEqual([{ value: 'b', label: 'b' }])
    expect(s.defaultModel).toBe('b')
  })
  it('setDefault：改默认', () => {
    expect(editModelsReducer(init, { type: 'setDefault', value: 'b' }).defaultModel).toBe('b')
  })
  it('add 带 label → label 生效，不填 label 回落 value', () => {
    const s1 = editModelsReducer({ models: [], defaultModel: '' }, { type: 'add', value: 'claude-opus-4-5', label: 'Opus 4.5' })
    expect(s1.models[0]).toEqual({ value: 'claude-opus-4-5', label: 'Opus 4.5' })
    const s2 = editModelsReducer({ models: [], defaultModel: '' }, { type: 'add', value: 'claude-opus-4-5' })
    expect(s2.models[0]).toEqual({ value: 'claude-opus-4-5', label: 'claude-opus-4-5' })
  })
})

test('claude：列默认 + 自定义项，点测试显示面板', async () => {
  render(<ProviderSection engine="claude" />)
  expect(await screen.findByText('FoxAPI')).toBeInTheDocument()
  expect(screen.getByText('使用本机 CLI 登录状态')).toBeInTheDocument()
  await userEvent.click(screen.getByText('测试'))
  expect(await screen.findByText(/Hey there!/)).toBeInTheDocument()
})

test('codex：渲染正常列表（显示 Codex CLI 标题，不显示旧占位）', async () => {
  render(<ProviderSection engine="codex" />)
  expect(await screen.findByText('Codex CLI')).toBeInTheDocument()
  expect(screen.queryByText(/codex 的上游 Provider 将在后续版本支持/)).not.toBeInTheDocument()
  expect(screen.getByText('使用本机 CLI 登录状态')).toBeInTheDocument()
})

test('claude：添加 Provider → 调 createProvider 并设为当前', async () => {
  render(<ProviderSection engine="claude" />)
  await screen.findByText('FoxAPI')
  await userEvent.click(screen.getByText('＋ 添加 Provider'))
  await userEvent.type(screen.getByPlaceholderText(/我的中转站/), '新中转')
  await userEvent.type(screen.getByPlaceholderText('https://api.example.com'), 'https://relay.example.com')
  // 密钥来源走选择器：手动新建一条密钥（保存时先入密钥库再以 apiKeySecretId 关联）
  const keySelect = screen.getByRole('option', { name: '选择密钥…' }).closest('select') as HTMLSelectElement
  await userEvent.selectOptions(keySelect, '__new__')
  await userEvent.type(screen.getByPlaceholderText(/密钥名称/), '新中转密钥')
  await userEvent.type(screen.getByPlaceholderText(/粘贴密钥|Token/), 'sk-newkey-1234')
  await userEvent.click(screen.getByText('保存'))
  await waitFor(() => expect(api.createSecret).toHaveBeenCalledWith(expect.objectContaining({ name: '新中转密钥', value: 'sk-newkey-1234' })))
  await waitFor(() => expect(api.createProvider).toHaveBeenCalledWith(expect.objectContaining({ engine: 'claude', name: '新中转', baseUrl: 'https://relay.example.com', apiKeySecretId: 'k-new', keyEnv: 'auth_token' })))
  expect(api.setActiveProvider).toHaveBeenCalledWith('claude', 'p-new')
})

test('claude：传 model prop → testProvider 带 model 参数', async () => {
  render(<ProviderSection engine="claude" model="sonnet" />)
  await screen.findByText('FoxAPI')
  await userEvent.click(screen.getByText('测试'))
  await waitFor(() => expect(api.testProvider).toHaveBeenCalledWith('p1', 'sonnet'))
})
