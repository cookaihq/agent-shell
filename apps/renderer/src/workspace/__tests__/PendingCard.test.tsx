import { test, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { PendingCard } from '../PendingCard'
import type { PendingRequest } from '../chatReducer'

const permReq: PendingRequest = { kind: 'permission', requestId: 'r1', toolName: 'Write', input: { file_path: 'a.ts' }, title: 'Claude 想写 a.ts' }
const askReq: PendingRequest = { kind: 'question', requestId: 'q1', questions: [{ question: '选哪个？', header: '方案', multiSelect: false, options: [{ label: 'A' }, { label: 'B' }] }] }

test('授权卡：同意 → onDecision(allow)；拒绝 → onDecision(deny)', async () => {
  const onDecision = vi.fn()
  render(<PendingCard reqs={[permReq]} onDecision={onDecision} />)
  expect(screen.getByText('Claude 想写 a.ts')).toBeInTheDocument()
  expect(screen.getByText('a.ts')).toBeInTheDocument()   // input 摘要
  await userEvent.click(screen.getByText('同意'))
  expect(onDecision).toHaveBeenCalledWith({ requestId: 'r1', behavior: 'allow' })
  await userEvent.click(screen.getByText('拒绝'))
  expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'r1', behavior: 'deny' }))
})

test('选择卡：选中后提交 → onDecision(allow, updatedInput.answers)', async () => {
  const onDecision = vi.fn()
  render(<PendingCard reqs={[askReq]} onDecision={onDecision} />)
  // 未选 → 提交禁用
  expect(screen.getByText('提交')).toBeDisabled()
  await userEvent.click(screen.getByText('A'))
  await userEvent.click(screen.getByText('提交'))
  // answers 为「问题文本 → 选中标签串」map（对齐 SDK AskUserQuestionOutput.answers）
  expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({
    requestId: 'q1', behavior: 'allow',
    updatedInput: { answers: { '选哪个？': 'A' } },
  }))
})

test('选择卡：关闭图标 → onDecision(deny, 跳过)（Issue 7）+ 问题区限高滚动容器（Issue 8）', async () => {
  const onDecision = vi.fn()
  const { container } = render(<PendingCard reqs={[askReq]} onDecision={onDecision} />)
  // 中间问题区是独立滚动容器（限高），提交按钮在其外
  expect(container.querySelector('.ask-q-scroll')).toBeTruthy()
  expect(container.querySelector('.ask-q-scroll .perm-card-actions')).toBeNull()
  // 关闭 = deny + 跳过提示
  await userEvent.click(screen.getByTitle('关闭并跳过此提问'))
  expect(onDecision).toHaveBeenCalledWith(expect.objectContaining({ requestId: 'q1', behavior: 'deny' }))
})

test('空列表 → 不渲染', () => {
  const { container } = render(<PendingCard reqs={[]} onDecision={() => {}} />)
  expect(container.firstChild).toBeNull()
})
