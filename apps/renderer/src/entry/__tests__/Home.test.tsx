import React from 'react'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { Home } from '../Home'
import type { ProjectDTO } from '../../api/types'
const projs: ProjectDTO[] = [
  { id: 'p1', name: 'seed-pitch-deck', path: '/x', createdAt: Date.now(), status: 'running', engine: 'claude' },
  { id: 'p2', name: 'api-gateway', path: '/y', createdAt: Date.now(), status: 'failed', engine: 'codex' },
]
function setup(over: Partial<React.ComponentProps<typeof Home>> = {}) {
  const props = { projects: projs, onSend: vi.fn(), onOpenProject: vi.fn(), onViewAll: vi.fn(), skillCount: 0, onOpenSkillModal: vi.fn(), ...over }
  render(<Home {...props} />); return props
}
test('渲染标题 + 最近项目卡', () => {
  setup()
  expect(screen.getByText('今天想构建点什么？')).toBeInTheDocument()
  expect(screen.getByText('最近项目')).toBeInTheDocument()
  expect(screen.getByText('seed-pitch-deck')).toBeInTheDocument()
})
test('Enter 发送非空文本 → onSend + 清空', async () => {
  const props = setup()
  const ta = screen.getByPlaceholderText(/描述你想让 agent 做的事/)
  await userEvent.type(ta, '写一个登录页')
  await userEvent.keyboard('{Enter}')
  expect(props.onSend).toHaveBeenCalledWith('写一个登录页', [])
  expect((ta as HTMLTextAreaElement).value).toBe('')
})
test('空文本不发送', async () => {
  const props = setup()
  await userEvent.click(screen.getByTitle('发送'))
  expect(props.onSend).not.toHaveBeenCalled()
})
test('注入技能 chip：count>0 显示徽标 + has 类 + 点击开模态', async () => {
  const props = setup({ skillCount: 2 })
  const btn = screen.getByText('注入技能').closest('button')!
  expect(btn.className).toContain('has')
  expect(screen.getByText('2')).toBeInTheDocument()
  await userEvent.click(btn)
  expect(props.onOpenSkillModal).toHaveBeenCalled()
})
test('查看全部 → onViewAll', async () => {
  const props = setup()
  await userEvent.click(screen.getByText(/查看全部/))
  expect(props.onViewAll).toHaveBeenCalled()
})
