import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Settings } from '../Settings'

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    enginesDetail: vi.fn().mockResolvedValue({ engines: [] }),
    getConfig: vi.fn().mockResolvedValue({ projectsDir: '/p', skillsDir: '/s' }),
    listSkills: vi.fn().mockResolvedValue({ skills: [] }),
  },
}))

test('渲染两导航（执行模式/系统设置）+ 默认执行模式 + 关闭', async () => {
  const onClose = vi.fn()
  render(<Settings section="exec" onClose={onClose} />)
  expect(screen.getByRole('button', { name: '执行模式' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '系统设置' })).toBeInTheDocument()
  expect(screen.queryByRole('button', { name: '技能' })).not.toBeInTheDocument()
  expect(screen.getByRole('heading', { name: '执行模式' })).toBeInTheDocument()
  await userEvent.keyboard('{Escape}')
  expect(onClose).toHaveBeenCalled()
})
