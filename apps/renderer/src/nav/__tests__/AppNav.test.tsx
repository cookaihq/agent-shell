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
  getConfig: vi.fn().mockResolvedValue({ projectsDir: '/p', skillsDir: '/s' }),
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
  it('会话改名 → 页签/列表即时刷新（回写 phase.sessions，不只发 PATCH）', async () => {
    const { api } = await import('../../api/client') as any
    const { container } = render(<SettingsProvider><AppNav /></SettingsProvider>); await act(async () => {})
    await userEvent.click((await screen.findByText('项目甲')).closest('.proj-card')!)
    await screen.findByText('会话一')
    await userEvent.click(await screen.findByTitle('历史会话'))   // 开历史弹窗
    await userEvent.click(await screen.findByTitle('重命名'))      // 进就地 input
    const input = container.querySelector('.hi-rename') as HTMLInputElement
    await userEvent.clear(input)
    await userEvent.type(input, '会话二{Enter}')
    expect(api.patchSession).toHaveBeenCalledWith('s1', { title: '会话二' })   // 落库
    expect(container.querySelector('.st-title')?.textContent).toBe('会话二')   // 页签即时刷新
    expect(screen.queryByText('会话一')).toBeNull()                            // 旧名全部消失
  })
  it('会话置顶 → 状态即时回写（pinned 反映到 UI，不只发 PATCH）', async () => {
    const { api } = await import('../../api/client') as any
    const { container } = render(<SettingsProvider><AppNav /></SettingsProvider>); await act(async () => {})
    await userEvent.click((await screen.findByText('项目甲')).closest('.proj-card')!)
    await screen.findByText('会话一')
    await userEvent.click(await screen.findByTitle('历史会话'))
    await userEvent.click(await screen.findByTitle('固定到顶部'))   // 点置顶
    expect(api.patchSession).toHaveBeenCalledWith('s1', { pinned: true })   // 落库
    expect(container.querySelector('.hist-item')?.className).toContain('is-pinned')   // 即时回写
    expect(await screen.findByTitle('取消固定')).toBeInTheDocument()        // 按钮态翻转
  })
  it('项目改名 → 顶部页签标题即时刷新（onRename 回写 projects）', async () => {
    const { api } = await import('../../api/client') as any
    api.renameProject.mockResolvedValue({ ok: true })
    const { container } = render(<SettingsProvider><AppNav /></SettingsProvider>); await act(async () => {})
    await userEvent.click((await screen.findByText('项目甲')).closest('.proj-card')!)
    await screen.findByText('会话一')
    const tabName = () => [...container.querySelectorAll('.ctab')].find((t) => !t.textContent?.includes('首页'))?.textContent
    await userEvent.click(await screen.findByTitle('点击重命名项目'))
    const input = container.querySelector('.proj-rename') as HTMLInputElement
    await userEvent.clear(input); await userEvent.type(input, '项目乙{Enter}')
    expect(api.renameProject).toHaveBeenCalledWith('p1', '项目乙')   // 落库
    expect(tabName()).toContain('项目乙')                            // 页签同步
    expect(container.querySelector('.proj-name')?.textContent).toContain('项目乙')  // 标题与页签同源
  })
  it('改名后被「在途旧 reload」覆盖 → 页签/标题仍保持新名（不回退、不分裂）', async () => {
    // 复现真实竞态：先点首页发出 GET /projects（读到旧名、在途），再进项目改名（乐观写新名 + PUT），
    // 随后那个旧 GET 才返回——旧版会用旧快照覆盖 projects，导致 tab 退回旧名而标题留新名（split-brain）。
    const { api } = await import('../../api/client') as any
    api.renameProject.mockResolvedValue({ ok: true })
    const stale = [{ id: 'p1', name: '项目甲', path: '/x', createdAt: 1, status: 'idle', engine: 'claude' }]
    const { container } = render(<SettingsProvider><AppNav /></SettingsProvider>); await act(async () => {})
    await userEvent.click((await screen.findByText('项目甲')).closest('.proj-card')!)
    await screen.findByText('会话一')
    // 安排「在途」reload：goHome 的 GET 返回一个我控制 resolve 时机的旧数据 promise
    let landStale: () => void = () => {}
    api.listProjects.mockImplementationOnce(() => new Promise((res) => { landStale = () => res({ projects: stale }) }))
    await userEvent.click([...container.querySelectorAll('.ctab')].find((t) => t.textContent?.includes('首页'))! as HTMLElement)  // goHome → 旧 GET 在途
    await userEvent.click([...container.querySelectorAll('.ctab')].find((t) => t.textContent?.includes('项目甲'))! as HTMLElement)  // 回到项目
    await screen.findByText('会话一')
    await userEvent.click(await screen.findByTitle('点击重命名项目'))
    const input = container.querySelector('.proj-rename') as HTMLInputElement
    await userEvent.clear(input); await userEvent.type(input, '项目乙{Enter}')   // 乐观改新名 + PUT
    await act(async () => { landStale(); await Promise.resolve(); await Promise.resolve() })  // 旧 GET 此刻才落地
    const projTab = [...container.querySelectorAll('.ctab')].find((t) => !t.textContent?.includes('首页'))
    expect(projTab?.textContent).toContain('项目乙')                                  // 页签不被旧 reload 覆盖回退
    expect(container.querySelector('.proj-name')?.textContent).toContain('项目乙')    // 标题与页签一致，无 split-brain
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
