import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ExecMode } from '../ExecMode'

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, api: {
  enginesDetail: vi.fn().mockResolvedValue({ engines: [
    { name: 'claude', label: 'Claude Code', bin: '/x/claude', version: '2.1.156' },
    { name: 'codex', label: 'Codex CLI', bin: null, version: null },
  ] }),
  // claude 有新版（2.1.156 < 2.1.162 → 提示）；codex 未装、版本 null → 不提示
  enginesUpdates: vi.fn().mockResolvedValue({ updates: [
    { name: 'claude', latestVersion: '2.1.162', updateUrl: 'https://github.com/anthropics/claude-code/releases' },
    { name: 'codex', latestVersion: '0.137.0', updateUrl: 'https://github.com/openai/codex/releases' },
  ] }),
  testEngine: vi.fn().mockResolvedValue({ ok: true, version: '2.1.156' }),
  // ProviderSection（ExecMode 内挂载）需要此方法
  listProviders: vi.fn().mockResolvedValue({ engines: {
    claude: { active: 'default', providers: [] },
    codex: { active: 'default', providers: [] },
  } }),
  setActiveProvider: vi.fn().mockResolvedValue({ ok: true }),
  // M2：每引擎默认模型持久化
  getConfig: vi.fn().mockResolvedValue({ projectsDir: '', skillsDir: '', engineModels: { claude: 'sonnet' } }),
  saveConfig: vi.fn().mockResolvedValue({}),
} }))

test('渲染 CLI 卡（版本/未检测）+ 测试 + 重新扫描', async () => {
  render(<ExecMode />)
  expect((await screen.findAllByText('Claude Code')).length).toBeGreaterThan(0)
  expect(screen.getByText('2.1.156')).toBeInTheDocument()
  expect(screen.getByText('Codex CLI')).toBeInTheDocument()
  await userEvent.click(screen.getByText('测试'))
  const { api } = await import('../../api/client') as any
  expect(api.testEngine).toHaveBeenCalledWith('claude')
})

test('模型 chip：持久化值 sonnet 高亮，点击 Opus 调用 saveConfig 并切换高亮', async () => {
  const { api } = await import('../../api/client') as any
  render(<ExecMode />)
  // getConfig 返回 { claude: 'sonnet' }，等待异步加载完成
  const sonnetChip = await screen.findByRole('button', { name: /Sonnet/ })
  expect(sonnetChip.className).toContain('on')
  // Default (recommended) chip 不高亮
  const defaultChip = screen.getByRole('button', { name: /Default \(recommended\)/ })
  expect(defaultChip.className).not.toContain('on')
  // 点击 Opus chip → 调用 saveConfig + 切换高亮
  const opusChip = screen.getByRole('button', { name: /^Opus\s*✓$/ })
  await userEvent.click(opusChip)
  expect(api.saveConfig).toHaveBeenCalledWith({ engineModels: { claude: 'opus' } })
})

test('已装版本落后时显示「有新版本」徽标，点击经 openExternal 打开官方 GitHub', async () => {
  const openExternal = vi.fn().mockResolvedValue({ ok: true })
  ;(window as unknown as { agentShell?: unknown }).agentShell = { openExternal }
  render(<ExecMode />)
  // claude 落后 → 出现徽标；codex 未装 → 无徽标
  const badge = await screen.findByText('↑ 有新版本 2.1.162')
  expect(badge).toBeInTheDocument()
  await userEvent.click(badge)
  expect(openExternal).toHaveBeenCalledWith('https://github.com/anthropics/claude-code/releases')
  delete (window as unknown as { agentShell?: unknown }).agentShell
})
