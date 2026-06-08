import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { TaskAutomation } from '../TaskAutomation'

const { items } = vi.hoisted(() => ({ items: [{
  id: 'mon', name: '晨间竞品监控', description: '抓竞品定价', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
  category: ['运营', '监控'], tags: ['监控'], triggers: [{ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }],
  executor: 'agent', requires: [], target: { mode: 'create_each_run' }, enabled: true, nextRunAt: null, createdAt: 0, updatedAt: 0, lastRun: null,
}] }))
vi.mock('../../api/client', () => ({ api: {
  listAutomations: vi.fn().mockResolvedValue({ automations: items }),
  listAutomationCategories: vi.fn().mockResolvedValue({ tree: [{ name: '运营', children: [{ name: '监控' }] }] }),
  listEntityRequirements: vi.fn().mockResolvedValue({ requirements: {} }),
  listSecrets: vi.fn().mockResolvedValue({ secrets: [], usage: {} }),
} }))

const props = { projects: [], onOpenSession: vi.fn() }

test('点「新建自动化」→ agent-led（onComposeToHome 收到组装提示词，不开弹窗）', async () => {
  const onCompose = vi.fn()
  render(<TaskAutomation {...props} onComposeToHome={onCompose} />)
  await userEvent.click(await screen.findByRole('button', { name: /新建自动化/ }))
  expect(onCompose).toHaveBeenCalledWith(expect.stringContaining('create_automation'))
  expect(screen.queryByText('保存设置')).toBeNull()  // 没开设置弹窗
})
test('卡片「编辑」→ agent-led 改内容（提示词含任务名）', async () => {
  const onCompose = vi.fn()
  render(<TaskAutomation {...props} onComposeToHome={onCompose} />)
  await userEvent.click(await screen.findByRole('button', { name: '编辑' }))
  expect(onCompose).toHaveBeenCalledWith(expect.stringContaining('晨间竞品监控'))
})
test('卡片「设置」→ 开设置弹窗（出现「保存设置」）', async () => {
  render(<TaskAutomation {...props} onComposeToHome={vi.fn()} />)
  await userEvent.click(await screen.findByRole('button', { name: '设置' }))
  expect(await screen.findByText('保存设置')).toBeInTheDocument()
})
