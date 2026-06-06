import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ProviderSection } from '../ProviderSection'
import { api } from '../../api/client'

vi.mock('../../api/client', () => ({ api: {
  listProviders: vi.fn().mockResolvedValue({ engines: {
    claude: { active: 'default', providers: [
      { id: 'p1', engine: 'claude', name: 'FoxAPI', baseUrl: 'https://api.foxapi.cc/', keyEnv: 'auth_token', hasKey: true, maskedKey: 'sk-…1234', sortIndex: 0, createdAt: 1 },
    ] },
    codex: { active: 'default', providers: [] },
  } }),
  setActiveProvider: vi.fn().mockResolvedValue({ ok: true }),
  testProvider: vi.fn().mockResolvedValue({ ok: true, requestText: 'REQ', responseText: 'Hey there!' }),
  createProvider: vi.fn().mockResolvedValue({ provider: { id: 'p-new', engine: 'claude', name: '新中转', baseUrl: 'https://relay.example.com', keyEnv: 'auth_token', hasKey: true, maskedKey: 'sk-…1234', sortIndex: 1, createdAt: 2 } }),
  updateProvider: vi.fn().mockResolvedValue({ provider: { id: 'p1', engine: 'claude', name: 'FoxAPI', baseUrl: 'https://api.foxapi.cc/', keyEnv: 'auth_token', hasKey: true, maskedKey: 'sk-…1234', sortIndex: 0, createdAt: 1 } }),
  deleteProvider: vi.fn().mockResolvedValue({ ok: true }),
}}))

test('claude：列默认 + 自定义项，点测试显示面板', async () => {
  render(<ProviderSection engine="claude" />)
  expect(await screen.findByText('FoxAPI')).toBeInTheDocument()
  expect(screen.getByText(/默认（CLI 登录态）/)).toBeInTheDocument()
  await userEvent.click(screen.getByText('测试'))
  expect(await screen.findByText(/Hey there!/)).toBeInTheDocument()
})

test('codex：显示后置占位，不渲染列表', () => {
  render(<ProviderSection engine="codex" />)
  expect(screen.getByText(/codex 的上游 Provider 将在后续版本支持/)).toBeInTheDocument()
})

test('claude：添加 Provider → 调 createProvider 并设为当前', async () => {
  render(<ProviderSection engine="claude" />)
  await screen.findByText('FoxAPI')
  await userEvent.click(screen.getByText('＋ 添加 Provider'))
  await userEvent.type(screen.getByPlaceholderText(/我的中转站/), '新中转')
  await userEvent.type(screen.getByPlaceholderText('https://api.example.com'), 'https://relay.example.com')
  await userEvent.type(screen.getByPlaceholderText('填写该 Provider 的密钥'), 'sk-newkey-1234')
  await userEvent.click(screen.getByText('保存'))
  await waitFor(() => expect(api.createProvider).toHaveBeenCalledWith(expect.objectContaining({ engine: 'claude', name: '新中转', baseUrl: 'https://relay.example.com', apiKey: 'sk-newkey-1234', keyEnv: 'auth_token' })))
  expect(api.setActiveProvider).toHaveBeenCalledWith('claude', 'p-new')
})

test('claude：传 model prop → testProvider 带 model 参数', async () => {
  render(<ProviderSection engine="claude" model="sonnet" />)
  await screen.findByText('FoxAPI')
  await userEvent.click(screen.getByText('测试'))
  await waitFor(() => expect(api.testProvider).toHaveBeenCalledWith('p1', 'sonnet'))
})
