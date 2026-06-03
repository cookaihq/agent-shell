import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import React from 'react'
import { RuntimeContext, initialRuntime } from '../runtimeState'
import type { RuntimeContextValue } from '../runtimeState'
import { ProjBar } from '../ProjBar'
import { api } from '../../api/client'
import { SettingsProvider } from '../../settings/SettingsContext'

// Mock the api module
vi.mock('../../api/client', () => ({
  api: {
    renameProject: vi.fn().mockResolvedValue(undefined),
  },
}))

function renderProjBar(
  opts: {
    projectId?: string
    projectName?: string
    engine?: 'claude' | 'codex'
    model?: string
    onBack?: () => void
  } = {}
) {
  const {
    projectId = 'proj-1',
    projectName = 'seed-pitch-deck',
    engine = 'claude',
    model = 'Claude Opus 4.8',
    onBack = vi.fn(),
  } = opts

  const runtime = initialRuntime(engine, model)
  const dispatch = vi.fn()
  const ctx: RuntimeContextValue = { runtime, dispatch }

  return render(
    <SettingsProvider>
      <RuntimeContext.Provider value={ctx}>
        <ProjBar projectId={projectId} projectName={projectName} engine={engine} onBack={onBack} />
      </RuntimeContext.Provider>
    </SettingsProvider>
  )
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
    const { container } = renderProjBar({ engine: 'codex', model: 'GPT 5.5' })
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

  it('Enter 确认 → 调 api.renameProject + 显示新名', async () => {
    const { container } = renderProjBar({ projectId: 'proj-1' })
    const projName = container.querySelector('.proj-name')!
    fireEvent.click(projName)
    const input = container.querySelector('input.proj-rename')! as HTMLInputElement
    fireEvent.change(input, { target: { value: '新项目名称' } })
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() => {
      expect(api.renameProject).toHaveBeenCalledWith('proj-1', '新项目名称')
    })
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
