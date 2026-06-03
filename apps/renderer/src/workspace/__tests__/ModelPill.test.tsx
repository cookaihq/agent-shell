/**
 * ModelPill.test.tsx — Task 16 测试
 *
 * 用真实 runtimeReducer/initialRuntime/useReducer（不用 inline mock reducer）
 * 在 RuntimeContext.Provider 下渲染，验证：
 *   - 脸显示模型名 + 权限/effort 胶囊
 *   - 弹窗：claude → 权限段 + Effort段 + 模型段
 *   - 弹窗：codex → 审批策略 + 沙箱级别 + Effort段 + 模型段
 *   - 点选选项 dispatch（前端状态，不碰后端）
 */
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useReducer } from 'react'
import type { ReactNode } from 'react'
import { ModelPill } from '../ModelPill'
import { RuntimeContext, initialRuntime, runtimeReducer } from '../runtimeState'

function Wrapper({ engine, children }: { engine: 'claude' | 'codex'; children?: ReactNode }) {
  const model = engine === 'claude' ? 'Claude Opus 4.8' : 'GPT 5.5'
  const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime(engine, model))
  return (
    <RuntimeContext.Provider value={{ runtime, dispatch }}>
      {children ?? <ModelPill />}
    </RuntimeContext.Provider>
  )
}

test('claude 脸显示模型名', () => {
  render(<Wrapper engine="claude" />)
  expect(screen.getByText('Claude Opus 4.8')).toBeInTheDocument()
})

test('claude 脸：弹窗有权限段 / 思考强度 / 模型段', async () => {
  render(<Wrapper engine="claude" />)
  await userEvent.click(screen.getByRole('button', { name: /Claude Opus/ }))
  expect(screen.getByText('权限')).toBeInTheDocument()
  expect(screen.getByText('思考强度')).toBeInTheDocument()
  // 模型段：应有模型列表里的某个模型
  expect(screen.getByText('Claude Opus 4.7')).toBeInTheDocument()
})

test('codex 弹窗有审批策略 + 沙箱级别', async () => {
  render(<Wrapper engine="codex" />)
  await userEvent.click(screen.getByRole('button', { name: /GPT 5/ }))
  expect(screen.getByText('审批策略')).toBeInTheDocument()
  expect(screen.getByText('沙箱级别')).toBeInTheDocument()
})

test('claude 弹窗点选权限项 → 前端状态更新（不传后端）', async () => {
  // 用一个能观察 runtime 变化的 wrapper
  function ObservableWrapper() {
    const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'Claude Opus 4.8'))
    return (
      <RuntimeContext.Provider value={{ runtime, dispatch }}>
        <ModelPill />
        {/* 显示当前 claudeMode 供断言 */}
        <span data-testid="mode">{runtime.claudeMode}</span>
      </RuntimeContext.Provider>
    )
  }
  render(<ObservableWrapper />)
  // 初始是 default
  expect(screen.getByTestId('mode').textContent).toBe('default')
  // 打开弹窗
  await userEvent.click(screen.getByRole('button', { name: /Claude Opus/ }))
  // 点「自动编辑」选项
  await userEvent.click(screen.getByText('自动编辑'))
  expect(screen.getByTestId('mode').textContent).toBe('acceptEdits')
})

test('点 model-btn 外部关闭弹窗', async () => {
  render(
    <div>
      <Wrapper engine="claude" />
      <div data-testid="outside">outside</div>
    </div>
  )
  await userEvent.click(screen.getByRole('button', { name: /Claude Opus/ }))
  expect(screen.getByText('权限')).toBeInTheDocument()
  // 点外部
  await userEvent.click(screen.getByTestId('outside'))
  expect(screen.queryByText('权限')).not.toBeInTheDocument()
})

test('Effort 点滑条切换', async () => {
  function ObservableWrapper() {
    const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'Claude Opus 4.8'))
    return (
      <RuntimeContext.Provider value={{ runtime, dispatch }}>
        <ModelPill />
        <span data-testid="effort">{runtime.effort.claude}</span>
      </RuntimeContext.Provider>
    )
  }
  render(<ObservableWrapper />)
  await userEvent.click(screen.getByRole('button', { name: /Claude Opus/ }))
  // 点「低」effort dot
  const dots = document.querySelectorAll('.effort-dot')
  await userEvent.click(dots[0] as HTMLElement)  // 第一个 = 'low'
  expect(screen.getByTestId('effort').textContent).toBe('low')
})
