import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { ChatHeader } from '../ChatHeader'
import type { SessionDTO } from '../../api/types'

const sess = (id: string, status: SessionDTO['status'], title = `会话${id}`): SessionDTO => ({
  id,
  projectId: 'p',
  engine: 'claude',
  model: 'opus',
  title,
  pinned: false,
  status,
  resumableId: 'r',
  createdAt: 0,
})

const base = {
  activeId: '1',
  activeRunning: false,
  messageCount: 0,
  onSelect: vi.fn(),
  onNew: vi.fn(),
  onResume: vi.fn(),
  onPin: vi.fn(),
  onRename: vi.fn(),
}

test('.chat-conv 渲染标题 .ct + 消息数 .cmeta', () => {
  const { container } = render(
    <ChatHeader {...base} messageCount={14} sessions={[sess('1', 'completed', '当前会话标题')]} />
  )
  expect(container.querySelector('.chat-conv .ct')?.textContent).toBe('当前会话标题')
  expect(container.querySelector('.chat-conv .cmeta')?.textContent).toBe('· 14 条消息')
})

test('hist-count 显示已完成会话数（排除当前会话）', () => {
  const { container } = render(
    <ChatHeader
      {...base}
      sessions={[sess('1', 'completed'), sess('2', 'completed'), sess('3', 'aborted')]}
    />
  )
  // 当前会话 id=1 被排除；s2 completed 计入；s3 aborted 不计入 → 1
  expect(container.querySelector('#histCount')?.textContent).toBe('1')
})

test('新会话按钮在 inline-switcher 外，点击触发 onNew', async () => {
  const onNew = vi.fn()
  const { container } = render(
    <ChatHeader {...base} onNew={onNew} sessions={[sess('1', 'completed')]} />
  )
  const newBtn = screen.getByTitle('新会话')
  // 新会话按钮不在 .inline-switcher 内
  expect(container.querySelector('.inline-switcher')?.contains(newBtn)).toBe(false)
  await userEvent.click(newBtn)
  expect(onNew).toHaveBeenCalledOnce()
})

test('点历史按钮开合 SessionHistory 弹窗', async () => {
  render(<ChatHeader {...base} sessions={[sess('1', 'completed')]} />)
  // 弹窗默认不渲染
  expect(document.querySelector('#chatHistPop')).toBeNull()
  await userEvent.click(screen.getByTitle('历史会话'))
  expect(document.querySelector('#chatHistPop')).toBeTruthy()
})
