import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act, fireEvent } from '@testing-library/react'
import { Workspace } from '../Workspace'
import { SettingsProvider } from '../../settings/SettingsContext'
import { NotificationsProvider } from '../../notifications/NotificationsContext'

// useAgentStream 改用 fetch + body.getReader() 读 SSE（不再用 EventSource）。
// 这里 stub 全局 fetch 返回一条可控流，测试用 emitSse 往里推帧。api client 另行 vi.mock，不经 fetch。
let streamCtrl: ReadableStreamDefaultController<Uint8Array> | null = null
const enc = new TextEncoder()

beforeEach(() => {
  streamCtrl = null
  const body = new ReadableStream<Uint8Array>({ start(c) { streamCtrl = c } })
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, body }) as unknown as Response))
})
afterEach(() => { vi.unstubAllGlobals() })

function emitSse(event: string, data: unknown) {
  streamCtrl!.enqueue(enc.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
}

// fs-watch 走另一条 fetch 流（/projects/:id/fs-stream）；本测试只验 SSE 消息流，stub fetch 是单条共享流，
// 两个读取者会抢同一 body reader（锁冲突）。生产里两者打不同真实端点、各自独立流，无此问题 → 这里 no-op 隔离。
vi.mock('../../hooks/useFsWatch', () => ({ useFsWatch: () => {} }))

// ── Mock api client ────────────────────────────────────────────────────────────
vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    // §8：端点回吐原始 transcript records；Workspace 经切片 historyService.rebuildBlocks 重建成 MessageDTO
    messages: vi.fn().mockResolvedValue({
      records: [
        { ts: 0, engine: 'claude', type: 'user_prompt', raw: { text: '历史消息', attachments: [] } },
      ],
    }),
    status: vi.fn().mockResolvedValue({ running: false, status: 'completed' }),
    usage: vi.fn().mockResolvedValue({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
    // Task 17: Composer 内用 api.files 加载项目文件列表
    files: vi.fn().mockResolvedValue({ tree: [] }),
    // Issue 5: Composer 内用 api.listSkills 加载技能候选
    listSkills: vi.fn().mockResolvedValue({ skills: [] }),
    // P2 命令源：Composer 内 useEffect 调 api.commands 拉斜杠命令（无活会话 → null）
    commands: vi.fn().mockResolvedValue({ commands: null }),
    // RuntimeSwitcher 开弹窗（claude supportsDynamicModels）→ 拉 supportedModels；无活会话回落静态
    models: vi.fn().mockResolvedValue({ models: null }),
    submit: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    renameProject: vi.fn().mockResolvedValue(undefined),
    patchSession: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue({ projectsDir: '/p', skillsDir: '/s' }),
    // Task 6.1：Workspace 挂载取凭证状态判定未登录 banner（默认 signed-in → 不显示，不干扰既有断言）
    getAuthStatus: vi.fn().mockResolvedValue({
      engines: {
        claude: { activeSource: 'cli-login', officialKey: {}, custom: [], cliLogin: { status: 'signed-in' }, oauth: { signedIn: false }, proxyBindings: {} },
        codex: { activeSource: 'cli-login', officialKey: {}, custom: [], cliLogin: { status: 'unknown' }, oauth: { signedIn: false }, proxyBindings: {} },
      },
    }),
    listProviders: vi.fn().mockResolvedValue({ engines: { claude: { active: 'default', providers: [] }, codex: { active: 'default', providers: [] } } }),
    // T7 提醒：useReminderTrigger → useReminders 挂载时拉项目配置（默认禁用）
    getReminders: vi.fn().mockResolvedValue({ version: 1, enabled: false, events: { attention: { channels: [], sound: { kind: 'system', id: 'default' } }, complete: { channels: [], sound: { kind: 'system', id: 'default' } }, failed: { channels: [], sound: { kind: 'system', id: 'default' } } }, external: { webhook: { enabled: false, secretRef: null }, feishu: { enabled: false, secretRef: null } } }),
    reminderSoundUrl: vi.fn((projectId: string, name: string) => `/api/projects/${projectId}/reminders/sounds/${name}`),
  },
}))

const defaultProps = {
  projectId: 'p1',
  projectName: 'test-project',
  projectPath: '/tmp/projects/p1',
  sessionId: 's1',
  engine: 'claude' as const,
  model: 'Claude Opus 4.8',
  sessions: [],
  openSessionIds: [],
  chrome: null,
  onSelectSession: vi.fn(),
  onCloseSessionTab: vi.fn(),
  onNewSession: vi.fn(),
  onBack: vi.fn(),
  onNewProject: vi.fn(),
  onRename: vi.fn(),
  onPatchSession: vi.fn(),
  onDeleteSession: vi.fn(),
  onChangeSessionEngine: vi.fn(),
  onSetProjectDefault: vi.fn(),
}

describe('Workspace', () => {
  it('进会话后渲染历史消息', async () => {
    render(<SettingsProvider><NotificationsProvider><Workspace {...defaultProps} /></NotificationsProvider></SettingsProvider>)
    // 用户消息渲染在消息体（用户消息白底框本身 sticky 贴顶，无单独摘要栏）
    expect((await screen.findAllByText('历史消息')).length).toBeGreaterThan(0)
  })

  it('SSE message 事件实时增量渲染', async () => {
    render(<SettingsProvider><NotificationsProvider><Workspace {...defaultProps} /></NotificationsProvider></SettingsProvider>)
    // 等历史加载完（attached=true，SSE fetch 已发起）
    expect((await screen.findAllByText('历史消息')).length).toBeGreaterThan(0)
    await act(async () => {})
    act(() => {
      emitSse('message', { type: 'message', text: '实时答复' })
    })
    expect(await screen.findByText('实时答复')).toBeInTheDocument()
  })

  it('渲染历史会话列表（ChatHeader 展示 sessions）', async () => {
    const sessions = [
      {
        id: 's1',
        projectId: 'p1',
        engine: 'claude' as const,
        model: 'opus',
        title: '当前会话',
        pinned: false,
        status: 'completed' as const,
        resumableId: null,
        createdAt: 0,
      },
      {
        id: 's2',
        projectId: 'p1',
        engine: 'claude' as const,
        model: 'opus',
        title: '历史会话B',
        pinned: false,
        status: 'completed' as const,
        resumableId: null,
        createdAt: 0,
      },
    ]
    render(<SettingsProvider><NotificationsProvider><Workspace {...defaultProps} sessions={sessions} /></NotificationsProvider></SettingsProvider>)
    // ChatHeader renders sessions（历史消息 列表可见）
    await screen.findAllByText('历史消息')
  })

  it('含 .split 容器 + .split-handle + Composer + file-workspace 占位', async () => {
    const { container } = render(<SettingsProvider><NotificationsProvider><Workspace {...defaultProps} /></NotificationsProvider></SettingsProvider>)
    await screen.findAllByText('历史消息')
    expect(container.querySelector('.split')).toBeTruthy()
    expect(container.querySelector('.split-handle')).toBeTruthy()
    // Task 15: 占位 div 已替换为真实 Composer（根 .composer，含 textarea）
    expect(container.querySelector('.composer')).toBeTruthy()
    expect(container.querySelector('[data-testid="file-workspace"]')).toBeTruthy()
  })

  it('运行时档位 → 回调 onRuntimeChange 同步 session 快照（修「切回没保持」）', async () => {
    const onRuntimeChange = vi.fn()
    await act(async () => {
      render(<SettingsProvider><NotificationsProvider><Workspace {...defaultProps} model="opus" onRuntimeChange={onRuntimeChange} /></NotificationsProvider></SettingsProvider>)
    })
    await screen.findAllByText('历史消息')
    // 挂载即用当前中立档位回调（sessionId + model/permissionMode/effort）→ AppNav 据此同步快照，切回不回退
    expect(onRuntimeChange).toHaveBeenCalledWith('s1', expect.objectContaining({
      model: 'opus', permissionMode: expect.any(String), effort: expect.any(String),
    }))
  })
})

describe('Workspace 切代理分流（会话区，Part B T5b）', () => {
  // 经真实 RuntimeSwitcher（Workspace 内层提供 RuntimeContext）开弹窗点 codex 触发 onAgentSwitch 分流。
  async function openSwitcherAndClickCodex(container: HTMLElement) {
    // 等历史/状态加载完成（attached 后 RuntimeSwitcher 也已挂）
    await act(async () => {})
    const chip = container.querySelector('.isw-chip')!
    await act(async () => { fireEvent.click(chip) })   // 开弹窗 → 拉 supportedModels（mock 返回 null）
    const codexBtn = container.querySelector('[data-agent="codex"]')!
    await act(async () => { fireEvent.click(codexBtn) })
  }

  it('未发送会话（messages 空）切 codex → onChangeSessionEngine(sessionId, projectId, codex)，不调 onSetProjectDefault', async () => {
    const { api } = await import('../../api/client') as any
    api.messages.mockResolvedValueOnce({ records: [] })   // 空会话：rebuildBlocks 产 0 条 → chat.messages 空
    const onChangeSessionEngine = vi.fn()
    const onSetProjectDefault = vi.fn()
    const { container } = render(
      <SettingsProvider><NotificationsProvider>
        <Workspace {...defaultProps} onChangeSessionEngine={onChangeSessionEngine} onSetProjectDefault={onSetProjectDefault} />
      </NotificationsProvider></SettingsProvider>
    )
    await openSwitcherAndClickCodex(container)
    expect(onChangeSessionEngine).toHaveBeenCalledWith('s1', 'p1', 'codex')
    expect(onSetProjectDefault).not.toHaveBeenCalled()
  })

  it('已发送会话（messages 非空）切 codex → onSetProjectDefault(projectId, codex)，不调 onChangeSessionEngine、不 patchSession', async () => {
    const { api } = await import('../../api/client') as any
    // 默认 api.messages 返回一条 user_prompt record → chat.messages 非空（已发送）
    const onChangeSessionEngine = vi.fn()
    const onSetProjectDefault = vi.fn()
    const { container } = render(
      <SettingsProvider><NotificationsProvider>
        <Workspace {...defaultProps} onChangeSessionEngine={onChangeSessionEngine} onSetProjectDefault={onSetProjectDefault} />
      </NotificationsProvider></SettingsProvider>
    )
    // 确认历史已渲染（已发送态确立）
    expect((await screen.findAllByText('历史消息')).length).toBeGreaterThan(0)
    await openSwitcherAndClickCodex(container)
    expect(onSetProjectDefault).toHaveBeenCalledWith('p1', 'codex')
    expect(onChangeSessionEngine).not.toHaveBeenCalled()
    expect(api.patchSession).not.toHaveBeenCalled()
  })

  it('与会话当前引擎相同（claude→claude）→ 不触发任何分流（中立 no-op）', async () => {
    const { api } = await import('../../api/client') as any
    api.messages.mockResolvedValueOnce({ records: [] })
    const onChangeSessionEngine = vi.fn()
    const onSetProjectDefault = vi.fn()
    const { container } = render(
      <SettingsProvider><NotificationsProvider>
        <Workspace {...defaultProps} onChangeSessionEngine={onChangeSessionEngine} onSetProjectDefault={onSetProjectDefault} />
      </NotificationsProvider></SettingsProvider>
    )
    await act(async () => {})
    await act(async () => { fireEvent.click(container.querySelector('.isw-chip')!) })
    await act(async () => { fireEvent.click(container.querySelector('[data-agent="claude"]')!) })   // 点当前引擎
    expect(onChangeSessionEngine).not.toHaveBeenCalled()
    expect(onSetProjectDefault).not.toHaveBeenCalled()
  })
})
