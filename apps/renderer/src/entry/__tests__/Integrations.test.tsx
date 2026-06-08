import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Integrations } from '../Integrations'
import { SettingsProvider } from '../../settings/SettingsContext'

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    listSkillGroups: vi.fn().mockResolvedValue({ groups: [] }),
    listSkillSources: vi.fn().mockResolvedValue({ sources: [] }),
    probeSkillSource: vi.fn().mockResolvedValue({ skills: [] }),
    reprobeSkillSource: vi.fn().mockResolvedValue({ skills: [] }),
    skillSourceMd: vi.fn().mockResolvedValue({ content: '' }),
    toggleSkillLib: vi.fn().mockResolvedValue({ ok: true }),
    setSourceUpdateMode: vi.fn().mockResolvedValue({ source: null }),
    patchSkillSource: vi.fn().mockResolvedValue({ source: null }),
    removeSkillSource: vi.fn().mockResolvedValue({ ok: true }),
    reorderSkillSources: vi.fn().mockResolvedValue({ ok: true }),
    listSkillLibrary: vi.fn().mockResolvedValue({ skills: [] }),
    getCliCatalog: vi.fn().mockResolvedValue({ tools: [] }),
    getCliInstalled: vi.fn().mockResolvedValue({ detected: [], custom: [], platform: 'darwin' }),
    listEntityRequirements: vi.fn().mockResolvedValue({ requirements: {} }),
    listSecrets: vi.fn().mockResolvedValue({ secrets: [], usage: {} }),
    getConfig: vi.fn().mockResolvedValue({ debugMode: false }),
  },
}))

function renderWithProvider(ui: React.ReactElement) {
  return render(<SettingsProvider>{ui}</SettingsProvider>)
}

test('1. 渲染 6 个集成 tab（含命令行工具）', async () => {
  renderWithProvider(<Integrations />)
  // 等 SkillsSettings 异步加载稳定，避免 act() 警告
  await waitFor(() => document.querySelector('.src-layout'))
  const tabBar = document.querySelector('.integ-tabs') as HTMLElement
  const inTabs = within(tabBar)
  expect(inTabs.getByRole('button', { name: /^技能/ })).toBeInTheDocument()
  expect(inTabs.getByRole('button', { name: /^MCP/ })).toBeInTheDocument()
  expect(inTabs.getByRole('button', { name: /^命令行工具/ })).toBeInTheDocument()
  expect(inTabs.getByRole('button', { name: /^连接器/ })).toBeInTheDocument()
  expect(inTabs.getByRole('button', { name: /^远程桥接/ })).toBeInTheDocument()
  expect(inTabs.getByRole('button', { name: /^数据同步/ })).toBeInTheDocument()
})

test('2. 技能 tab 默认激活，SkillsSettings UI 渲染', async () => {
  renderWithProvider(<Integrations />)
  const tabBar = document.querySelector('.integ-tabs') as HTMLElement
  const inTabs = within(tabBar)
  const skillsTab = inTabs.getByRole('button', { name: /^技能/ })
  expect(skillsTab.className).toContain('is-active')
  // SkillsSettings 渲染后 .src-layout 出现
  expect(await screen.findByText(/还没有技能分组/)).toBeInTheDocument()
})

test('3. 点 MCP tab → 显示即将上线占位，SkillsSettings 消失', async () => {
  renderWithProvider(<Integrations />)
  // 等 SkillsSettings 渲染完毕
  await screen.findByText(/还没有技能分组/)
  const tabBar = document.querySelector('.integ-tabs') as HTMLElement
  const inTabs = within(tabBar)
  await userEvent.click(inTabs.getByRole('button', { name: /^MCP/ }))
  expect(await screen.findByText('MCP 服务器')).toBeInTheDocument()
  expect(document.querySelector('.integ-soon-card')).toBeInTheDocument()
  expect(screen.queryByText(/还没有技能分组/)).not.toBeInTheDocument()
})

test('4. 点命令行工具 tab → 渲染 CLI 工具市场（真实功能，非占位）', async () => {
  renderWithProvider(<Integrations />)
  await screen.findByText(/还没有技能分组/)
  const tabBar = document.querySelector('.integ-tabs') as HTMLElement
  const inTabs = within(tabBar)
  await userEvent.click(inTabs.getByRole('button', { name: /^命令行工具/ }))
  // 市场标题出现；非「即将上线」占位卡
  expect(await screen.findByRole('heading', { name: '命令行工具' })).toBeInTheDocument()
  expect(document.querySelector('.integ-soon-card')).not.toBeInTheDocument()
  // set-h（命令行工具区段标题）已在屏幕上
  expect(document.querySelector('.set-h')).toBeInTheDocument()
})
