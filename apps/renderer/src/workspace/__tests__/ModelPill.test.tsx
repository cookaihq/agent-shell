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
  const model = engine === 'claude' ? 'opus' : 'GPT 5.5'
  const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime(engine, model))
  return (
    <RuntimeContext.Provider value={{ runtime, dispatch }}>
      {children ?? <ModelPill />}
    </RuntimeContext.Provider>
  )
}

test('claude 脸显示模型名（value→displayName）', () => {
  render(<Wrapper engine="claude" />)
  expect(screen.getByText('Opus')).toBeInTheDocument()   // 'opus' → 'Opus'
})

test('claude 弹窗有权限段（5 档）+ 思考强度 + 模型段', async () => {
  render(<Wrapper engine="claude" />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  // 权限选择器加回（接 SDK 真链路）：权限段 + 5 档之一
  expect(screen.getByText('权限')).toBeInTheDocument()
  expect(screen.getByText('绕过权限')).toBeInTheDocument()
  expect(screen.getByText('思考强度')).toBeInTheDocument()
  expect(screen.getByText('Haiku')).toBeInTheDocument()   // 静态兜底列表含 Haiku 项
})

test('claude 点权限档 → dispatch SET_CLAUDE_MODE（脸胶囊更新）', async () => {
  function ObservableWrapper() {
    const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'opus'))
    return (
      <RuntimeContext.Provider value={{ runtime, dispatch }}>
        <ModelPill />
        <span data-testid="cmode">{runtime.claudeMode}</span>
      </RuntimeContext.Provider>
    )
  }
  render(<ObservableWrapper />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  await userEvent.click(screen.getByText('计划模式'))
  expect(screen.getByTestId('cmode').textContent).toBe('plan')
})

test('codex 弹窗有审批策略 + 沙箱级别', async () => {
  render(<Wrapper engine="codex" />)
  await userEvent.click(screen.getByRole('button', { name: /GPT 5/ }))
  expect(screen.getByText('审批策略')).toBeInTheDocument()
  expect(screen.getByText('沙箱级别')).toBeInTheDocument()
})

test('点 model-btn 外部关闭弹窗', async () => {
  render(
    <div>
      <Wrapper engine="claude" />
      <div data-testid="outside">outside</div>
    </div>
  )
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  expect(screen.getByText('思考强度')).toBeInTheDocument()
  // 点外部
  await userEvent.click(screen.getByTestId('outside'))
  expect(screen.queryByText('思考强度')).not.toBeInTheDocument()
})

test('Effort 点滑条切换', async () => {
  function ObservableWrapper() {
    const [runtime, dispatch] = useReducer(runtimeReducer, undefined, () => initialRuntime('claude', 'opus'))
    return (
      <RuntimeContext.Provider value={{ runtime, dispatch }}>
        <ModelPill />
        <span data-testid="effort">{runtime.effort.claude}</span>
      </RuntimeContext.Provider>
    )
  }
  render(<ObservableWrapper />)
  await userEvent.click(screen.getByRole('button', { name: /opus/i }))
  // 点「低」effort dot
  const dots = document.querySelectorAll('.effort-dot')
  await userEvent.click(dots[0] as HTMLElement)  // 第一个 = 'low'
  expect(screen.getByTestId('effort').textContent).toBe('low')
})
