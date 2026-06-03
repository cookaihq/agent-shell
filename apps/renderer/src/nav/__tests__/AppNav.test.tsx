import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { AppNav } from '../AppNav'
import { SettingsProvider } from '../../settings/SettingsContext'

class FakeES { addEventListener() {} removeEventListener() {} close() {} constructor(public url: string) {} }
vi.mock('../../api/client', () => ({ ApiError: class extends Error { constructor(public code: string) { super() } }, api: {
  engines: vi.fn().mockResolvedValue({ engines: { claude: '/c', codex: null } }),
  listProjects: vi.fn().mockResolvedValue({ projects: [{ id: 'p1', name: '项目甲', path: '/x', createdAt: 1, status: 'idle', engine: 'claude' }] }),
  listSessions: vi.fn().mockResolvedValue({ sessions: [{ id: 's1', projectId: 'p1', engine: 'claude', model: 'opus', title: '会话一', pinned: false, status: 'completed', resumableId: 'r', createdAt: 1 }] }),
  messages: vi.fn().mockResolvedValue({ messages: [] }), status: vi.fn().mockResolvedValue({ running: false, status: 'completed' }),
  usage: vi.fn().mockResolvedValue({ inputTokens: 0, outputTokens: 0, costUsd: 0 }), files: vi.fn().mockResolvedValue({ tree: [] }),
  createSession: vi.fn().mockResolvedValue({ sessionId: 's-new' }), createProject: vi.fn().mockResolvedValue({ projectId: 'p-new', path: '/p-new' }),
  renameProject: vi.fn(), patchSession: vi.fn(), resume: vi.fn(), interrupt: vi.fn(), submit: vi.fn(),
  listSkills: vi.fn().mockResolvedValue({ skills: [] }),
} }))
// 页签持久在 localStorage（workspaceTabs），用例间必须清，否则上个用例残留的项目页签会
// 被下个用例 loadTabs 恢复为 active → 渲染成项目视图而非首页，串状态。
beforeEach(() => { (globalThis as any).EventSource = FakeES; vi.clearAllMocks(); globalThis.localStorage?.clear() })

describe('AppNav', () => {
  it('engines gate 通过 → 默认 home，渲染最近项目', async () => {
    render(<SettingsProvider><AppNav /></SettingsProvider>); await act(async () => {})
    expect(await screen.findByText('今天想构建点什么？')).toBeInTheDocument()
    expect(await screen.findByText('项目甲')).toBeInTheDocument()
  })
  it('home 点项目卡 → 进 workspace', async () => {
    render(<SettingsProvider><AppNav /></SettingsProvider>); await act(async () => {})
    await userEvent.click((await screen.findByText('项目甲')).closest('.proj-card')!)
    expect(await screen.findByText('会话一')).toBeInTheDocument()
  })
  it('engines 全缺 → no-cli 提示', async () => {
    const { api } = await import('../../api/client') as any
    api.engines.mockResolvedValueOnce({ engines: { claude: null, codex: null } })
    render(<SettingsProvider><AppNav /></SettingsProvider>); await act(async () => {})
    expect(await screen.findByText(/未检测到/)).toBeInTheDocument()
  })
  it('workspace 点返回 → 切回首页但项目页签保留、首页页签激活（reloadProjects 抛错也照切）', async () => {
    const { api } = await import('../../api/client') as any
    const { container } = render(<SettingsProvider><AppNav /></SettingsProvider>); await act(async () => {})
    await userEvent.click((await screen.findByText('项目甲')).closest('.proj-card')!)
    await screen.findByText('会话一')
    expect(container.querySelectorAll('.ctab').length).toBe(2)   // 首页 + 项目页签
    api.listProjects.mockRejectedValueOnce(new Error('boom'))    // 返回时刷新失败也不挟持导航
    await userEvent.click(await screen.findByTitle('返回首页'))
    await act(async () => {})
    expect(await screen.findByText('今天想构建点什么？')).toBeInTheDocument()   // 已切回首页视图
    expect(container.querySelectorAll('.ctab').length).toBe(2)   // 项目页签保留（返回不关）
    const homeTab = [...container.querySelectorAll('.ctab')].find((t) => t.textContent?.includes('首页'))
    expect(homeTab?.className).toContain('is-active')            // 首页页签激活
  })
  it('home 发送把选中技能传给 createProject（第二参为数组）', async () => {
    const { api } = await import('../../api/client') as any
    render(<SettingsProvider><AppNav /></SettingsProvider>); await act(async () => {})
    const ta = await screen.findByPlaceholderText(/描述你想让 agent/)
    await userEvent.type(ta, '做个登录页')
    await userEvent.keyboard('{Enter}')
    expect(api.createProject).toHaveBeenCalledWith('未命名项目', expect.any(Array))
  })
})
