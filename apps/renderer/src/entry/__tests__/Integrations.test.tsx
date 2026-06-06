import { render, screen, within, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Integrations } from '../Integrations'

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
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
    listCliTools: vi.fn().mockResolvedValue({ tools: [] }),
    detectClis: vi.fn().mockResolvedValue({ detected: {} }),
    addCliTool: vi.fn().mockResolvedValue({ tool: null }),
    removeCliTool: vi.fn().mockResolvedValue({ ok: true }),
  },
}))

test('1. 渲染 6 个集成 tab（含命令行工具）', async () => {
  render(<Integrations />)
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
  render(<Integrations />)
  const tabBar = document.querySelector('.integ-tabs') as HTMLElement
  const inTabs = within(tabBar)
  const skillsTab = inTabs.getByRole('button', { name: /^技能/ })
  expect(skillsTab.className).toContain('is-active')
  // SkillsSettings 渲染后 .src-layout 出现
  expect(await screen.findByText(/还没有技能源/)).toBeInTheDocument()
})

test('3. 点 MCP tab → 显示即将上线占位，SkillsSettings 消失', async () => {
  render(<Integrations />)
  // 等 SkillsSettings 渲染完毕
  await screen.findByText(/还没有技能源/)
  const tabBar = document.querySelector('.integ-tabs') as HTMLElement
  const inTabs = within(tabBar)
  await userEvent.click(inTabs.getByRole('button', { name: /^MCP/ }))
  expect(await screen.findByText('MCP 服务器')).toBeInTheDocument()
  expect(document.querySelector('.integ-soon-card')).toBeInTheDocument()
  expect(screen.queryByText(/还没有技能源/)).not.toBeInTheDocument()
})

test('4. 点命令行工具 tab → 渲染 CLI 工具市场（真实功能，非占位）', async () => {
  render(<Integrations />)
  await screen.findByText(/还没有技能源/)
  const tabBar = document.querySelector('.integ-tabs') as HTMLElement
  const inTabs = within(tabBar)
  await userEvent.click(inTabs.getByRole('button', { name: /^命令行工具/ }))
  // 市场标题 + 推荐区出现；非「即将上线」占位卡
  expect(await screen.findByRole('heading', { name: '命令行工具' })).toBeInTheDocument()
  expect(await screen.findByText('yt-dlp')).toBeInTheDocument()
  expect(document.querySelector('.clit-grid')).toBeInTheDocument()
  expect(document.querySelector('.integ-soon-card')).not.toBeInTheDocument()
})
