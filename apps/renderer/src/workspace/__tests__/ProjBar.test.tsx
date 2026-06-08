import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { RuntimeContext, initialRuntime } from '../runtimeState'
import type { RuntimeContextValue } from '../runtimeState'
import { ProjBar } from '../ProjBar'
import { api } from '../../api/client'
import { SettingsProvider } from '../../settings/SettingsContext'

// useReminders（ProjBar 红点 + 提醒模态）依赖 useFsWatch 订阅 SSE；测试环境无 fetch，mock 掉
vi.mock('../../hooks/useFsWatch', () => ({ useFsWatch: () => {} }))

// Mock the api module（提醒相关方法须齐全：useReminders → getReminders）
vi.mock('../../api/client', () => {
  const DEFAULT_REMINDERS = {
    version: 1,
    enabled: false,
    events: {
      attention: { channels: [], sound: { kind: 'system', id: 'default' } },
      complete: { channels: [], sound: { kind: 'system', id: 'default' } },
      failed: { channels: [], sound: { kind: 'system', id: 'default' } },
    },
    external: { webhook: { enabled: false, secretRef: null }, feishu: { enabled: false, secretRef: null } },
  }
  return {
    api: {
      renameProject: vi.fn().mockResolvedValue(undefined),
      getConfig: vi.fn().mockResolvedValue({ projectsDir: '/p', skillsDir: '/s' }),
      listProviders: vi.fn().mockResolvedValue({ engines: { claude: { active: 'default', providers: [] }, codex: { active: 'default', providers: [] } } }),
      getReminders: vi.fn().mockResolvedValue(DEFAULT_REMINDERS),
      putReminders: vi.fn().mockResolvedValue(DEFAULT_REMINDERS),
      uploadReminderSound: vi.fn().mockResolvedValue({ file: '.agent-shell/sounds/x.mp3' }),
      reminderSoundUrl: (pid: string, name: string) => `/api/projects/${pid}/reminders/sounds/${name}`,
      createSecret: vi.fn().mockResolvedValue({ secret: { id: 'sec-new', name: 'n', note: '', hasValue: true, maskedValue: '', createdAt: 0 } }),
      updateSecret: vi.fn().mockResolvedValue({ secret: { id: 'sec-1', name: 'n', note: '', hasValue: true, maskedValue: '', createdAt: 0 } }),
    },
  }
})

function renderProjBar(
  opts: {
    projectId?: string
    projectName?: string
    engine?: 'claude' | 'codex'
    model?: string
    onBack?: () => void
    onRename?: (name: string) => void
    selectedAgent?: 'claude' | 'codex' | null
  } = {}
) {
  const {
    projectId = 'proj-1',
    projectName = 'seed-pitch-deck',
    engine = 'claude',
    model = 'Claude Opus 4.8',
    onBack = vi.fn(),
    onRename,
    selectedAgent,
  } = opts

  const runtime = initialRuntime(engine, model)
  const dispatch = vi.fn()
  const ctx: RuntimeContextValue = { runtime, dispatch }

  const tree = (name: string) => (
    <SettingsProvider>
      <RuntimeContext.Provider value={ctx}>
        <ProjBar projectId={projectId} projectName={name} engine={engine} onBack={onBack} onRename={onRename} selectedAgent={selectedAgent} />
      </RuntimeContext.Provider>
    </SettingsProvider>
  )
  const r = render(tree(projectName))
  return { ...r, rerenderWithName: (name: string) => r.rerender(tree(name)) }
}

describe('ProjBar 结构', () => {
  it('渲染 .proj-bar', () => {
    const { container } = renderProjBar()
    expect(container.querySelector('.proj-bar')).toBeTruthy()
  })

  it('渲染返回按钮 .chat-hicon', () => {
    const { container } = renderProjBar()
    expect(container.querySelector('.chat-hicon')).toBeTruthy()
  })

  it('渲染 .title 含 .engdot 和项目名', () => {
    const { container } = renderProjBar()
    expect(container.querySelector('.title')).toBeTruthy()
    expect(container.querySelector('.engdot')).toBeTruthy()
    expect(screen.getByText('seed-pitch-deck')).toBeTruthy()
  })

  it('engdot 反映真实引擎色（claude → var(--claude)）', () => {
    const { container } = renderProjBar({ engine: 'claude' })
    const dot = container.querySelector('.engdot') as HTMLElement
    expect(dot.style.background).toBe('var(--claude)')
  })

  it('engdot 反映真实引擎色（codex → var(--codex)，不写死 claude）', () => {
    const { container } = renderProjBar({ engine: 'codex', model: 'gpt-5.5' })
    const dot = container.querySelector('.engdot') as HTMLElement
    expect(dot.style.background).toBe('var(--codex)')
    expect(dot.style.background).not.toBe('var(--claude)')
  })

  it('渲染 .spacer 和 RuntimeSwitcher（.inline-switcher）', () => {
    const { container } = renderProjBar()
    expect(container.querySelector('.spacer')).toBeTruthy()
    expect(container.querySelector('.inline-switcher')).toBeTruthy()
  })
})

describe('ProjBar 返回按钮', () => {
  it('点击返回按钮触发 onBack', () => {
    const onBack = vi.fn()
    const { container } = renderProjBar({ onBack })
    const backBtn = container.querySelector('.chat-hicon')!
    fireEvent.click(backBtn)
    expect(onBack).toHaveBeenCalledOnce()
  })
})

describe('ProjBar 项目名就地重命名', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(api.renameProject).mockResolvedValue(undefined)
  })

  it('点击 .proj-name 变为 input', () => {
    const { container } = renderProjBar()
    const projName = container.querySelector('.proj-name')!
    fireEvent.click(projName)
    expect(container.querySelector('input.proj-rename')).toBeTruthy()
  })

  it('Enter 确认 → 调 onRename + api.renameProject；显示名跟随 projectName prop（受控）', async () => {
    // ProjBar 受控：自身不缓存显示名，改名只回传 onRename + 落库；显示新名由父级更新 projectName prop 驱动。
    const onRename = vi.fn()
    const { container, rerenderWithName } = renderProjBar({ projectId: 'proj-1', onRename })
    const projName = container.querySelector('.proj-name')!
    fireEvent.click(projName)
    const input = container.querySelector('input.proj-rename')! as HTMLInputElement
    fireEvent.change(input, { target: { value: '新项目名称' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(onRename).toHaveBeenCalledWith('新项目名称')
      expect(api.renameProject).toHaveBeenCalledWith('proj-1', '新项目名称')
    })
    // 父级据 onRename 更新 projectName → ProjBar 显示新名（与顶部页签同源）
    rerenderWithName('新项目名称')
    expect(container.querySelector('.proj-name')?.textContent).toBe('新项目名称')
  })

  it('Esc 取消 → 恢复原名，不调 api', async () => {
    const { container } = renderProjBar({ projectName: 'seed-pitch-deck' })
    const projName = container.querySelector('.proj-name')!
    fireEvent.click(projName)
    const input = container.querySelector('input.proj-rename')! as HTMLInputElement
    fireEvent.change(input, { target: { value: '改了又不要' } })
    fireEvent.keyDown(input, { key: 'Escape' })
    expect(container.querySelector('.proj-name')?.textContent).toBe('seed-pitch-deck')
    expect(api.renameProject).not.toHaveBeenCalled()
  })

  it('blur 提交（非空值）→ 调 api.renameProject', async () => {
    const { container } = renderProjBar({ projectId: 'proj-1' })
    const projName = container.querySelector('.proj-name')!
    fireEvent.click(projName)
    const input = container.querySelector('input.proj-rename')! as HTMLInputElement
    fireEvent.change(input, { target: { value: 'blur提交名' } })
    fireEvent.blur(input)
    await waitFor(() => {
      expect(api.renameProject).toHaveBeenCalledWith('proj-1', 'blur提交名')
    })
  })

  it('空值 blur → 恢复原名', async () => {
    const { container } = renderProjBar({ projectName: 'original' })
    const projName = container.querySelector('.proj-name')!
    fireEvent.click(projName)
    const input = container.querySelector('input.proj-rename')! as HTMLInputElement
    fireEvent.change(input, { target: { value: '   ' } }) // 空白
    fireEvent.blur(input)
    expect(container.querySelector('.proj-name')?.textContent).toBe('original')
    expect(api.renameProject).not.toHaveBeenCalled()
  })
})

describe('ProjBar 下个新会话标记（proj-next-agent）', () => {
  it('selectedAgent 与 engine 不同时显示标记，文案含 Codex CLI，色点用 codex 色', () => {
    const { container } = renderProjBar({ engine: 'claude', selectedAgent: 'codex' })
    const mark = container.querySelector('.proj-next-agent') as HTMLElement | null
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toContain('下个新会话用 Codex CLI')
    const dot = mark!.querySelector('.pna-dot') as HTMLElement | null
    expect(dot).not.toBeNull()
    expect(dot!.style.background).toBe('var(--codex)')
  })

  it('selectedAgent 与 engine 相同时不显示标记', () => {
    const { container } = renderProjBar({ engine: 'claude', selectedAgent: 'claude' })
    expect(container.querySelector('.proj-next-agent')).toBeNull()
  })

  it('selectedAgent 为 null 时不显示标记', () => {
    const { container } = renderProjBar({ engine: 'claude', selectedAgent: null })
    expect(container.querySelector('.proj-next-agent')).toBeNull()
  })

  it('selectedAgent 未传时不显示标记', () => {
    const { container } = renderProjBar({ engine: 'claude' })
    expect(container.querySelector('.proj-next-agent')).toBeNull()
  })

  it('engine=codex, selectedAgent=claude 时显示标记，文案含 Claude Code，色点用 claude 色', () => {
    const { container } = renderProjBar({ engine: 'codex', model: 'gpt-5.5', selectedAgent: 'claude' })
    const mark = container.querySelector('.proj-next-agent') as HTMLElement | null
    expect(mark).not.toBeNull()
    expect(mark!.textContent).toContain('下个新会话用 Claude Code')
    const dot = mark!.querySelector('.pna-dot') as HTMLElement | null
    expect(dot).not.toBeNull()
    expect(dot!.style.background).toBe('var(--claude)')
  })
})
