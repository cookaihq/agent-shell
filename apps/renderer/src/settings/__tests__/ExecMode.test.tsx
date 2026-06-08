import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ExecMode } from '../ExecMode'

// 默认引擎列表（多数用例用这套）。codex 兼容徽标用例会用 enginesDetail.mockResolvedValueOnce 覆盖。
const enginesDetailMock = vi.fn().mockResolvedValue({ engines: [
  { name: 'claude', label: 'Claude Code', bin: '/x/claude', version: '2.1.156' },
  { name: 'codex', label: 'Codex CLI', bin: null, version: null },
] })

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, api: {
  enginesDetail: (...args: unknown[]) => enginesDetailMock(...args),
  testEngine: vi.fn().mockResolvedValue({ ok: true, version: '2.1.156' }),
  // ProviderSection（ExecMode 内挂载）需要此方法
  listProviders: vi.fn().mockResolvedValue({ engines: {
    claude: { active: 'default', providers: [] },
    codex: { active: 'default', providers: [] },
  } }),
  setActiveProvider: vi.fn().mockResolvedValue({ ok: true }),
  // ProviderSection 挂载时加载密钥库（API Key 选择器）
  listSecrets: vi.fn().mockResolvedValue({ secrets: [], usage: {} }),
  // M2：每引擎默认模型持久化
  getConfig: vi.fn().mockResolvedValue({ projectsDir: '', skillsDir: '', engineModels: { claude: 'sonnet' } }),
  saveConfig: vi.fn().mockResolvedValue({}),
  // 凭证来源（Task 2.4 官方组）：ProviderSection 挂载时拉取来源状态
  getAuthStatus: vi.fn().mockResolvedValue({ engines: {
    claude: { activeSource: 'cli-login', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: {} },
    codex: { activeSource: 'cli-login', officialKey: {}, custom: [], oauth: { signedIn: false }, proxyBindings: {} },
  } }),
  setAuthSource: vi.fn().mockResolvedValue({ ok: true }),
  setOfficialKey: vi.fn().mockResolvedValue({ ok: true }),
  // 代理绑定（Task 5.4）：ProviderSection 挂载时拉取代理池
  listProxies: vi.fn().mockResolvedValue({ proxies: [] }),
  setSourceProxy: vi.fn().mockResolvedValue({ ok: true }),
} }))

test('渲染 CLI 卡（版本/未检测）+ 测试 + 自带引擎标题', async () => {
  render(<ExecMode />)
  expect((await screen.findAllByText('Claude Code')).length).toBeGreaterThan(0)
  expect(screen.getByText('2.1.156')).toBeInTheDocument()
  expect(screen.getByText('Codex CLI')).toBeInTheDocument()
  // 标题文案对齐「自带引擎」架构
  expect(screen.getByText(/自带引擎/)).toBeInTheDocument()
  expect(screen.getByText(/随 Agent Shell 打包，无需本机安装/)).toBeInTheDocument()
  await userEvent.click(screen.getByText('测试'))
  const { api } = await import('../../api/client') as any
  expect(api.testEngine).toHaveBeenCalledWith('claude')
})

test('codex 版本在已测试集合内 → 显示「✓ 已适配」徽标', async () => {
  enginesDetailMock.mockResolvedValueOnce({ engines: [
    { name: 'codex', label: 'Codex CLI', bin: '/x/codex', version: '0.137.0' },
  ] })
  render(<ExecMode />)
  expect(await screen.findByText(/已适配/)).toBeInTheDocument()
  expect(screen.queryByText(/未测试版本/)).not.toBeInTheDocument()
})

test('codex 版本不在已测试集合内 → 显示「⚠️ 未测试版本」提示（非硬阻断）', async () => {
  enginesDetailMock.mockResolvedValueOnce({ engines: [
    { name: 'codex', label: 'Codex CLI', bin: '/x/codex', version: '0.140.0' },
  ] })
  render(<ExecMode />)
  expect(await screen.findByText(/未测试版本/)).toBeInTheDocument()
  expect(screen.queryByText(/已适配/)).not.toBeInTheDocument()
})

test('claude 卡不显示 codex 兼容徽标', async () => {
  enginesDetailMock.mockResolvedValueOnce({ engines: [
    { name: 'claude', label: 'Claude Code', bin: '/x/claude', version: '2.1.156' },
  ] })
  render(<ExecMode />)
  expect((await screen.findAllByText('Claude Code')).length).toBeGreaterThan(0)
  expect(screen.queryByText(/已适配/)).not.toBeInTheDocument()
  expect(screen.queryByText(/未测试版本/)).not.toBeInTheDocument()
})

test('codex 版本缺失（未检测到）→ 不显示兼容徽标', async () => {
  enginesDetailMock.mockResolvedValueOnce({ engines: [
    { name: 'codex', label: 'Codex CLI', bin: '/x/codex', version: null },
  ] })
  render(<ExecMode />)
  expect((await screen.findAllByText('Codex CLI')).length).toBeGreaterThan(0)
  expect(screen.queryByText(/已适配/)).not.toBeInTheDocument()
  expect(screen.queryByText(/未测试版本/)).not.toBeInTheDocument()
})
