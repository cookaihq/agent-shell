import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import React from 'react'
import { RuntimeContext, initialRuntime, runtimeReducer } from '../runtimeState'
import { RuntimeSwitcher } from '../RuntimeSwitcher'
import type { RuntimeContextValue, RuntimeAction, RuntimeState } from '../runtimeState'
import { SettingsProvider } from '../../settings/SettingsContext'

function makeCtx(engine: 'claude' | 'codex' = 'claude', model = 'Claude Opus 4.8') {
  const runtime = initialRuntime(engine, model)
  return runtime
}

function renderWithCtx(runtime: RuntimeState, dispatch = vi.fn()) {
  const ctx: RuntimeContextValue = { runtime, dispatch }
  return render(
    <SettingsProvider>
      <RuntimeContext.Provider value={ctx}>
        <RuntimeSwitcher />
      </RuntimeContext.Provider>
    </SettingsProvider>
  )
}

describe('RuntimeSwitcher 渲染', () => {
  it('渲染 .inline-switcher 包裹 .isw-chip', () => {
    const { container } = renderWithCtx(makeCtx())
    expect(container.querySelector('.inline-switcher')).toBeTruthy()
    expect(container.querySelector('.isw-chip')).toBeTruthy()
  })

  it('chip text 含 本地 CLI · Claude Code · 模型名', () => {
    renderWithCtx(makeCtx())
    // chip 中的 isw-mode span
    expect(screen.getByText('本地 CLI')).toBeTruthy()
    // "Claude Code" 在 chip（isw-primary）和弹窗 agent 按钮 ag-nm 里都有，用 getAllByText
    expect(screen.getAllByText('Claude Code').length).toBeGreaterThan(0)
    // 模型名在 chip isw-model + select option 里都有
    expect(screen.getAllByText('Claude Opus 4.8').length).toBeGreaterThan(0)
  })

  it('codex 引擎显示 Codex CLI', () => {
    renderWithCtx(makeCtx('codex', 'GPT 5.5'))
    // "Codex CLI" 在 chip isw-primary 和弹窗 ag-nm 里都有
    expect(screen.getAllByText('Codex CLI').length).toBeGreaterThan(0)
    expect(screen.getAllByText('GPT 5.5').length).toBeGreaterThan(0)
  })

  it('默认弹窗关闭（isw-pop 无 open class）', () => {
    const { container } = renderWithCtx(makeCtx())
    const pop = container.querySelector('.isw-pop')
    expect(pop?.classList.contains('open')).toBe(false)
  })
})

describe('RuntimeSwitcher 弹窗开合 (wirePopover)', () => {
  it('点击 isw-chip 打开弹窗，aria-expanded → true', () => {
    const { container } = renderWithCtx(makeCtx())
    const chip = container.querySelector('.isw-chip')!
    fireEvent.click(chip)
    expect(container.querySelector('.isw-pop')?.classList.contains('open')).toBe(true)
    expect(chip.getAttribute('aria-expanded')).toBe('true')
  })

  it('再次点击 isw-chip 关闭弹窗', () => {
    const { container } = renderWithCtx(makeCtx())
    const chip = container.querySelector('.isw-chip')!
    fireEvent.click(chip)
    fireEvent.click(chip)
    expect(container.querySelector('.isw-pop')?.classList.contains('open')).toBe(false)
    expect(chip.getAttribute('aria-expanded')).toBe('false')
  })

  it('点外部区域关闭弹窗', () => {
    const { container } = renderWithCtx(makeCtx())
    const chip = container.querySelector('.isw-chip')!
    fireEvent.click(chip)
    expect(container.querySelector('.isw-pop')?.classList.contains('open')).toBe(true)
    // 点击 document（外部）
    fireEvent.click(document.body)
    expect(container.querySelector('.isw-pop')?.classList.contains('open')).toBe(false)
  })
})

describe('RuntimeSwitcher dispatch 交互', () => {
  it('点 claude 代理按钮 → dispatch SET_AGENT claude', () => {
    const dispatch = vi.fn()
    const runtime = initialRuntime('codex', 'GPT 5.5')
    renderWithCtx(runtime, dispatch)
    // 先打开弹窗
    const chip = document.querySelector('.isw-chip')!
    fireEvent.click(chip)
    // 找到 data-agent="claude" 按钮
    const claudeBtn = document.querySelector('[data-agent="claude"]')!
    fireEvent.click(claudeBtn)
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_AGENT', agent: 'claude' })
  })

  it('点 codex 代理按钮 → dispatch SET_AGENT codex', () => {
    const dispatch = vi.fn()
    const runtime = initialRuntime('claude', 'Claude Opus 4.8')
    renderWithCtx(runtime, dispatch)
    const chip = document.querySelector('.isw-chip')!
    fireEvent.click(chip)
    const codexBtn = document.querySelector('[data-agent="codex"]')!
    fireEvent.click(codexBtn)
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_AGENT', agent: 'codex' })
  })

  it('改 select → dispatch SET_MODEL', () => {
    const dispatch = vi.fn()
    renderWithCtx(makeCtx(), dispatch)
    const chip = document.querySelector('.isw-chip')!
    fireEvent.click(chip)
    const select = document.querySelector('.isw-select') as HTMLSelectElement
    fireEvent.change(select, { target: { value: 'Claude Sonnet 4.6' } })
    expect(dispatch).toHaveBeenCalledWith({ type: 'SET_MODEL', model: 'Claude Sonnet 4.6' })
  })
})

describe('RuntimeSwitcher isw-pop 结构', () => {
  it('弹窗包含 .isw-mode-cli、代理 grid、模型 select', () => {
    const { container } = renderWithCtx(makeCtx())
    const chip = container.querySelector('.isw-chip')!
    fireEvent.click(chip)
    expect(container.querySelector('.isw-mode-cli')).toBeTruthy()
    expect(container.querySelector('.isw-agent-grid')).toBeTruthy()
    expect(container.querySelector('.isw-select')).toBeTruthy()
  })

  it('当前引擎的代理按钮有 is-active class', () => {
    const { container } = renderWithCtx(makeCtx('claude'))
    const chip = container.querySelector('.isw-chip')!
    fireEvent.click(chip)
    const claudeBtn = container.querySelector('[data-agent="claude"]')!
    const codexBtn = container.querySelector('[data-agent="codex"]')!
    expect(claudeBtn.classList.contains('is-active')).toBe(true)
    expect(codexBtn.classList.contains('is-active')).toBe(false)
  })
})
