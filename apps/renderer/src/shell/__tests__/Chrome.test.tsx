import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Chrome } from '../Chrome'
import { homeTab, projectTab } from '../workspaceTabs'
import type { ProjectDTO } from '../../api/types'

const proj = (id: string, name: string): ProjectDTO =>
  ({ id, name, path: '/p/' + id, createdAt: 0, status: 'idle', engine: 'claude', selectedAgent: null })

test('项目页签标题按 projectId 现查 projects（改名即同步）', () => {
  const home = homeTab(1)
  const pt = projectTab('P1', 2)
  render(
    <Chrome
      tabs={[home, pt]} activeTabId={pt.id}
      projects={[proj('P1', '小红书图片修改')]}
      onSelectTab={vi.fn()} onCloseTab={vi.fn()} onNewTab={vi.fn()}
    />,
  )
  expect(screen.getByText('首页')).toBeInTheDocument()
  expect(screen.getByText('小红书图片修改')).toBeInTheDocument()
})

test('点页签 → onSelectTab；点 × → onCloseTab（不触发 select）', async () => {
  const home = homeTab(1)
  const pt = projectTab('P1', 2)
  const onSelect = vi.fn()
  const onClose = vi.fn()
  const { container } = render(
    <Chrome
      tabs={[home, pt]} activeTabId={home.id}
      projects={[proj('P1', 'P 项目')]}
      onSelectTab={onSelect} onCloseTab={onClose} onNewTab={vi.fn()}
    />,
  )
  await userEvent.click(screen.getByText('P 项目'))
  expect(onSelect).toHaveBeenCalledWith(pt)
  onSelect.mockClear()
  // 点项目页签的 ×
  const projectTabEl = container.querySelectorAll('.chrome-tabs .ctab')[1]
  await userEvent.click(projectTabEl.querySelector('.x')!)
  expect(onClose).toHaveBeenCalledWith(pt.id)
  expect(onSelect).not.toHaveBeenCalled()
})

test('+ 触发 onNewTab（新建/聚焦首页页签）', async () => {
  const onNew = vi.fn()
  const home = homeTab(1)
  render(
    <Chrome
      tabs={[home]} activeTabId={home.id}
      projects={[]} onSelectTab={vi.fn()} onCloseTab={vi.fn()} onNewTab={onNew}
    />,
  )
  await userEvent.click(screen.getByTitle('新建标签页'))
  expect(onNew).toHaveBeenCalled()
})
