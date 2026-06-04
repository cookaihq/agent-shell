/**
 * Composer.test.tsx — Task 15 测试
 *
 * 验证：Enter 发送/清空、Shift+Enter 不发、运行中变停止键→onInterrupt
 *
 * 注意：Composer 内含 ModelPill，ModelPill 需要 RuntimeContext.Provider。
 * Workspace 已在 Task 14 包裹 Provider，但单元测试需要自己提供 Provider。
 */
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Composer } from '../Composer'
import { RuntimeContext, initialRuntime, runtimeReducer } from '../runtimeState'
import { useReducer } from 'react'
import type { ReactNode } from 'react'

function Wrapper({ children }: { children: ReactNode }) {
  const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'Claude Opus 4.8'))
  return (
    <RuntimeContext.Provider value={{ runtime, dispatch }}>
      {children}
    </RuntimeContext.Provider>
  )
}

const p = {
  running: false,
  onSubmit: vi.fn(),
  onInterrupt: vi.fn(),
  engine: 'claude' as const,
  model: 'Claude Opus 4.8',
  projectId: 'x',
}

test('Enter 发送并清空', async () => {
  const onSubmit = vi.fn()
  render(
    <Wrapper>
      <Composer {...p} onSubmit={onSubmit} />
    </Wrapper>
  )
  const ta = screen.getByRole('textbox')
  await userEvent.type(ta, '你好{Enter}')
  expect(onSubmit).toHaveBeenCalledWith('你好', [])
  expect((ta as HTMLTextAreaElement).value).toBe('')
})

test('Shift+Enter 不发送', async () => {
  const onSubmit = vi.fn()
  render(
    <Wrapper>
      <Composer {...p} onSubmit={onSubmit} />
    </Wrapper>
  )
  await userEvent.type(screen.getByRole('textbox'), 'a{Shift>}{Enter}{/Shift}')
  expect(onSubmit).not.toHaveBeenCalled()
})

test('运行中显示停止键 → onInterrupt', async () => {
  const onInterrupt = vi.fn()
  render(
    <Wrapper>
      <Composer {...p} running onInterrupt={onInterrupt} />
    </Wrapper>
  )
  await userEvent.click(screen.getByTitle('中断当前任务'))
  expect(onInterrupt).toHaveBeenCalled()
})

test('空闲时显示发送键', () => {
  render(
    <Wrapper>
      <Composer {...p} />
    </Wrapper>
  )
  expect(screen.getByTitle('发送')).toBeInTheDocument()
})

test('运行中发送键带 is-running 类', () => {
  render(
    <Wrapper>
      <Composer {...p} running />
    </Wrapper>
  )
  const btn = screen.getByTitle('中断当前任务')
  expect(btn.classList.contains('is-running')).toBe(true)
})
