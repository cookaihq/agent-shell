import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { NewProjectModal } from '../NewProjectModal'

vi.mock('../../api/client', () => ({
  api: {
    createProject: vi.fn().mockResolvedValue({ projectId: 'proj-123', path: '/data/proj-123' }),
    getConfig: vi.fn().mockResolvedValue({ projectsDir: '/Users/me/AgentShell/projects' }),
  },
}))

test('输入名称点「创建项目」→ api.createProject 被调、onCreated 收到 projectId', async () => {
  const onCreated = vi.fn()
  const onClose = vi.fn()
  render(<NewProjectModal onClose={onClose} onCreated={onCreated} />)

  // 弹窗有标题
  expect(screen.getByText('新建项目')).toBeInTheDocument()

  // 存储位置只显示父级目录（不带具体项目 ID），且只读不可改——纯文本展示、无「更改…」按钮、无输入框
  expect(await screen.findByText('/Users/me/AgentShell/projects')).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '更改…' })).not.toBeInTheDocument()
  expect(screen.queryByDisplayValue('/Users/me/AgentShell/projects')).not.toBeInTheDocument()

  // 输入名称
  await userEvent.clear(screen.getByPlaceholderText('未命名项目'))
  await userEvent.type(screen.getByPlaceholderText('未命名项目'), '我的项目')

  // 点创建
  await userEvent.click(screen.getByRole('button', { name: '创建项目' }))

  const { api } = await import('../../api/client')
  expect(api.createProject).toHaveBeenCalledWith('我的项目')
  expect(onCreated).toHaveBeenCalledWith('proj-123')
})

test('点取消 → onClose 被调', async () => {
  const onClose = vi.fn()
  render(<NewProjectModal onClose={onClose} onCreated={vi.fn()} />)
  await userEvent.click(screen.getByRole('button', { name: '取消' }))
  expect(onClose).toHaveBeenCalled()
})

test('Esc → onClose 被调', async () => {
  const onClose = vi.fn()
  render(<NewProjectModal onClose={onClose} onCreated={vi.fn()} />)
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
})

test('点遮罩 → onClose 被调', async () => {
  const onClose = vi.fn()
  const { container } = render(<NewProjectModal onClose={onClose} onCreated={vi.fn()} />)
  const backdrop = container.querySelector('.modal-backdrop')!
  await userEvent.click(backdrop)
  expect(onClose).toHaveBeenCalled()
})
