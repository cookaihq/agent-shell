import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, expect, test, vi } from 'vitest'
import { Projects } from '../Projects'
import type { ProjectDTO } from '../../api/types'

const projs: ProjectDTO[] = [
  { id: 'p1', name: 'seed-pitch-deck', path: '/x', createdAt: 3000, status: 'completed', engine: 'claude' },
  { id: 'p2', name: 'api-gateway', path: '/y', createdAt: 1000, status: 'idle', engine: 'codex' },
  { id: 'p3', name: 'zeta-tool', path: '/z', createdAt: 2000, status: 'running', engine: 'claude' },
]

function setup(over: Partial<Parameters<typeof Projects>[0]> = {}) {
  const onOpenProject = vi.fn(), onRenameProject = vi.fn(), onDeleteProjects = vi.fn()
  render(<Projects projects={projs} onOpenProject={onOpenProject} onRenameProject={onRenameProject} onDeleteProjects={onDeleteProjects} {...over} />)
  return { onOpenProject, onRenameProject, onDeleteProjects }
}

beforeEach(() => localStorage.clear())

test('网格渲染全部项目 + 点击 onOpen', async () => {
  const { onOpenProject } = setup()
  expect(screen.getByRole('heading', { name: '项目' })).toBeInTheDocument()
  expect(screen.getByText('seed-pitch-deck')).toBeInTheDocument()
  await userEvent.click(screen.getByText('api-gateway').closest('.proj-card')!)
  expect(onOpenProject).toHaveBeenCalledWith('p2')
})

test('搜索过滤名称', async () => {
  setup()
  await userEvent.type(screen.getByPlaceholderText('搜索…'), 'gateway')
  expect(screen.getByText('api-gateway')).toBeInTheDocument()
  expect(screen.queryByText('seed-pitch-deck')).not.toBeInTheDocument()
})

test('选择态：勾选 + 批量删除走确认 → onDeleteProjects', async () => {
  const { onDeleteProjects, onOpenProject } = setup()
  await userEvent.click(screen.getByRole('button', { name: '选择' }))
  // 选择态下点卡片是选中而非打开
  await userEvent.click(screen.getByText('seed-pitch-deck').closest('.proj-card')!)
  await userEvent.click(screen.getByText('zeta-tool').closest('.proj-card')!)
  expect(onOpenProject).not.toHaveBeenCalled()
  expect(screen.getByText('已选 2 个')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: '删除所选' })) // 工具栏按钮 → 开确认弹窗
  await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: '删除所选' }))
  expect(onDeleteProjects).toHaveBeenCalledWith(['p1', 'p3'])
})

test('切看板 → 按状态分列、选择按钮消失', async () => {
  setup()
  await userEvent.click(screen.getByRole('button', { name: '看板' }))
  expect(screen.queryByRole('button', { name: '选择' })).not.toBeInTheDocument()
  const running = screen.getByText('运行中').closest('.proj-kanban-col') as HTMLElement
  expect(within(running).getByText('zeta-tool')).toBeInTheDocument()
})

test('排序下拉切到「名称」→ 卡片按字母序', async () => {
  setup()
  await userEvent.click(screen.getByRole('button', { name: /最近创建/ }))
  await userEvent.click(screen.getByRole('menuitem', { name: /名称/ }))
  const names = [...document.querySelectorAll('.proj-name')].map((n) => n.textContent)
  expect(names).toEqual(['api-gateway', 'seed-pitch-deck', 'zeta-tool'])
})

test('⋯ 菜单重命名 → onRenameProject', async () => {
  const { onRenameProject } = setup()
  const card = screen.getByText('seed-pitch-deck').closest('.proj-card') as HTMLElement
  await userEvent.click(within(card).getByRole('button')) // ⋯ more（卡片内唯一按钮）
  await userEvent.click(screen.getByRole('menuitem', { name: '重命名' }))
  const input = screen.getByDisplayValue('seed-pitch-deck')
  await userEvent.clear(input)
  await userEvent.type(input, 'renamed')
  await userEvent.click(screen.getByRole('button', { name: '保存' }))
  expect(onRenameProject).toHaveBeenCalledWith('p1', 'renamed')
})
