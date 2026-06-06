// App.test.tsx — App 渲染 AppNav；mock api 避免真实网络请求
import { render, screen, act } from '@testing-library/react'
import { vi } from 'vitest'
import { App } from '../App'

class FakeES {
  addEventListener() {}
  removeEventListener() {}
  close() {}
  constructor(public url: string) {}
}

vi.mock('../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    engines: vi.fn().mockResolvedValue({ engines: { claude: '/usr/bin/claude', codex: null } }),
    listProjects: vi.fn().mockResolvedValue({ projects: [{ id: 'p1', name: 'TestProject', path: '/p', createdAt: 0, status: 'idle', engine: 'claude' }] }),
    listSessions: vi.fn().mockResolvedValue({ sessions: [{ id: 's1', projectId: 'p1', engine: 'claude', model: 'opus', title: 'TestSession', pinned: false, status: 'idle', resumableId: null, createdAt: 0 }] }),
    messages: vi.fn().mockResolvedValue({ records: [] }),
    status: vi.fn().mockResolvedValue({ running: false, status: 'idle' }),
    usage: vi.fn().mockResolvedValue({ inputTokens: 0, outputTokens: 0, costUsd: 0 }),
    files: vi.fn().mockResolvedValue({ tree: [] }),
    createSession: vi.fn(),
    createProject: vi.fn(),
    renameProject: vi.fn(),
    patchSession: vi.fn(),
    resume: vi.fn(),
    interrupt: vi.fn(),
    submit: vi.fn(),
    getConfig: vi.fn().mockResolvedValue({ projectsDir: '/p', skillsDir: '/s' }),
  },
}))

beforeEach(() => {
  ;(globalThis as any).EventSource = FakeES
})

test('App 渲染 home（engines gate 通过后显示入口屏 + 最近项目）', async () => {
  render(<App />)
  await act(async () => {})
  expect(await screen.findByText('今天想构建点什么？')).toBeInTheDocument()
  expect(await screen.findByText('TestProject')).toBeInTheDocument()
})
