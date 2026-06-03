import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Rail } from '../Rail'

test('渲染 3 个导航按钮 + active 高亮 + 回调', async () => {
  const onNewProject = vi.fn(), onHome = vi.fn(), onProjects = vi.fn()
  render(<Rail active="home" onNewProject={onNewProject} onHome={onHome} onProjects={onProjects} />)
  expect(screen.getByLabelText('新建项目')).toBeInTheDocument()
  const homeBtn = screen.getByLabelText('工作区')
  expect(homeBtn.className).toContain('is-active')
  expect(screen.getByLabelText('项目').className).not.toContain('is-active')
  await userEvent.click(screen.getByLabelText('新建项目'))
  expect(onNewProject).toHaveBeenCalled()
  await userEvent.click(screen.getByLabelText('项目'))
  expect(onProjects).toHaveBeenCalled()
})
