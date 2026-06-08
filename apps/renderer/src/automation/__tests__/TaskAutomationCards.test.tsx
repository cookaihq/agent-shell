import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { TaskAutomation } from '../TaskAutomation'

const { items } = vi.hoisted(() => ({ items: [
  {
    id: 'mon', name: '晨间竞品监控', description: '', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
    category: ['运营', '监控'], tags: ['监控', '竞品'],
    triggers: [{ kind: 'startup' }, { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }],
    executor: 'agent', requires: [{ kind: 'env', name: 'COMPETITOR_API_KEY' }], target: { mode: 'create_each_run' },
    enabled: true, nextRunAt: null, createdAt: 0, updatedAt: 0, lastRun: null,
  },
  {
    id: 'wk', name: '周报初稿生成', description: '', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
    category: ['工程', '文档'], tags: ['周报'],
    triggers: [{ kind: 'weekly', time: '18:00', timezone: 'Asia/Shanghai', weekday: 5 }],
    executor: 'agent', requires: [], target: { mode: 'create_each_run' },
    enabled: true, nextRunAt: null, createdAt: 0, updatedAt: 0, lastRun: null,
  },
] }))
vi.mock('../../api/client', () => ({ api: {
  listAutomations: vi.fn().mockResolvedValue({ automations: items }),
  listAutomationCategories: vi.fn().mockResolvedValue({ tree: [{ name: '运营', children: [{ name: '监控' }] }, { name: '工程', children: [{ name: '文档' }] }] }),
  listEntityRequirements: vi.fn().mockResolvedValue({ requirements: {} }),
  listSecrets: vi.fn().mockResolvedValue({ secrets: [], usage: {} }),
} }))

const props = { projects: [], onOpenSession: vi.fn(), onComposeToHome: vi.fn() }

test('卡片显示分类面包屑 / 标签 / 配置标志 / 多触发 meta', async () => {
  render(<TaskAutomation {...props} />)
  expect(await screen.findByText('运营 › 监控')).toBeInTheDocument()      // 面包屑
  expect(screen.getAllByText('竞品').length).toBeGreaterThan(0)           // 标签 chip
  expect(screen.getByText('需配置')).toBeInTheDocument()                  // requires 非空且未绑
  expect(screen.getByText(/启动时 · 每天 09:00/)).toBeInTheDocument()     // 多触发 meta
})
test('分类 drill：钻入「运营」只看其下任务', async () => {
  render(<TaskAutomation {...props} />)
  await screen.findByText('晨间竞品监控')
  await userEvent.click(screen.getByRole('button', { name: '运营' }))
  expect(screen.getByText('晨间竞品监控')).toBeInTheDocument()
  expect(screen.queryByText('周报初稿生成')).toBeNull()                   // 工程/文档 被滤掉
})
test('标签 + 分类 AND 合并', async () => {
  render(<TaskAutomation {...props} />)
  await screen.findByText('晨间竞品监控')
  await userEvent.click(screen.getByRole('button', { name: '运营' }))   // 分类
  await userEvent.click(screen.getByRole('button', { name: '竞品' }))   // 标签
  expect(screen.getByText('晨间竞品监控')).toBeInTheDocument()
  expect(screen.queryByText('周报初稿生成')).toBeNull()
})
