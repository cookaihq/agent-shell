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

// ── Mock api client ────────────────────────────────────────────────────────────
vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    messages: vi.fn().mockResolvedValue({
      messages: [
        {
          id: 'm1',
          sessionId: 's1',
          role: 'user',
          blocks: [{ type: 'text', text: '历史消息' }],
          createdAt: 0,
        },
      ],
    }),
    status: vi.fn().mockResolvedValue({ running: false, status: 'completed' }),
    usage: vi.fn().mockResolvedValue({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
    // Task 17: Composer 内用 api.files 加载项目文件列表
    files: vi.fn().mockResolvedValue({ tree: [] }),
    submit: vi.fn().mockResolvedValue(undefined),
    interrupt: vi.fn().mockResolvedValue(undefined),
    resume: vi.fn().mockResolvedValue(undefined),
    renameProject: vi.fn().mockResolvedValue(undefined),
    patchSession: vi.fn().mockResolvedValue(undefined),
  },
}))

const defaultProps = {
  projectId: 'p1',
  projectName: 'test-project',
  sessionId: 's1',
  engine: 'claude' as const,
  model: 'Claude Opus 4.8',
  sessions: [],
  chrome: null,
  onSelectSession: vi.fn(),
  onNewSession: vi.fn(),
  onBack: vi.fn(),
  onNewProject: vi.fn(),
  onRename: vi.fn(),
}

describe('Workspace', () => {
  it('进会话后渲染历史消息', async () => {
    render(<SettingsProvider><Workspace {...defaultProps} /></SettingsProvider>)
    expect(await screen.findByText('历史消息')).toBeInTheDocument()
  })

  it('SSE message 事件实时增量渲染', async () => {
    render(<SettingsProvider><Workspace {...defaultProps} /></SettingsProvider>)
    // 等历史加载完（attached=true，SSE fetch 已发起）
    expect(await screen.findByText('历史消息')).toBeInTheDocument()
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
    // ChatHeader renders hist-count badge (should show done count)
    await screen.findByText('历史消息')
    // hist-count visible with at least one done session
    const histCount = document.querySelector('#histCount')
    expect(histCount).toBeTruthy()
  })

  it('含 .split 容器 + .split-handle + Composer + file-workspace 占位', async () => {
    const { container } = render(<SettingsProvider><Workspace {...defaultProps} /></SettingsProvider>)
    await screen.findByText('历史消息')
    expect(container.querySelector('.split')).toBeTruthy()
    expect(container.querySelector('.split-handle')).toBeTruthy()
    // Task 15: 占位 div 已替换为真实 Composer（根 .composer，含 textarea）
    expect(container.querySelector('.composer')).toBeTruthy()
    expect(container.querySelector('[data-testid="file-workspace"]')).toBeTruthy()
  })
})
