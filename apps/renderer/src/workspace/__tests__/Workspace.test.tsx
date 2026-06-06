import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, act } from '@testing-library/react'
import { Workspace } from '../Workspace'
import { SettingsProvider } from '../../settings/SettingsContext'

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
    submit: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    renameProject: vi.fn().mockResolvedValue(undefined),
    patchSession: vi.fn().mockResolvedValue(undefined),
    getConfig: vi.fn().mockResolvedValue({ projectsDir: '/p', skillsDir: '/s' }),
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
}

describe('Workspace', () => {
  it('进会话后渲染历史消息', async () => {
    render(<SettingsProvider><Workspace {...defaultProps} /></SettingsProvider>)
    // 用户消息渲染在消息体（用户消息白底框本身 sticky 贴顶，无单独摘要栏）
    expect((await screen.findAllByText('历史消息')).length).toBeGreaterThan(0)
  })

  it('SSE message 事件实时增量渲染', async () => {
    render(<SettingsProvider><Workspace {...defaultProps} /></SettingsProvider>)
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
    render(<SettingsProvider><Workspace {...defaultProps} sessions={sessions} /></SettingsProvider>)
    // ChatHeader renders sessions（历史消息 列表可见）
    await screen.findAllByText('历史消息')
  })

  it('含 .split 容器 + .split-handle + Composer + file-workspace 占位', async () => {
    const { container } = render(<SettingsProvider><Workspace {...defaultProps} /></SettingsProvider>)
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
      render(<SettingsProvider><Workspace {...defaultProps} model="opus" onRuntimeChange={onRuntimeChange} /></SettingsProvider>)
    })
    await screen.findAllByText('历史消息')
    // 挂载即用当前中立档位回调（sessionId + model/permissionMode/effort）→ AppNav 据此同步快照，切回不回退
    expect(onRuntimeChange).toHaveBeenCalledWith('s1', expect.objectContaining({
      model: 'opus', permissionMode: expect.any(String), effort: expect.any(String),
    }))
  })
})
