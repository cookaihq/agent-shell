import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { AutomationSettingsModal } from '../AutomationModal'

const patch = vi.fn().mockResolvedValue({ automation: {} })
vi.mock('../../api/client', () => ({ api: {
  patchAutomation: (...a: unknown[]) => patch(...a),
  listSecrets: vi.fn().mockResolvedValue({ secrets: [{ id: 'k1', name: 'FoxAPI Key', note: '', hasValue: true, maskedValue: '…ab', createdAt: 0 }], usage: {} }),
  listEntityRequirements: vi.fn().mockResolvedValue({ requirements: {} }),
  putEntityRequirements: vi.fn().mockResolvedValue({ ok: true }),
  createSecret: vi.fn().mockResolvedValue({ id: 'k2' }),
} }))

const auto = {
  id: 'mon', name: '晨间竞品监控', description: '', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
  category: ['运营', '监控'], tags: ['监控', '竞品'],
  triggers: [{ kind: 'startup' }, { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }],
  executor: 'agent', requires: [{ kind: 'env', name: 'COMPETITOR_API_KEY' }],
  target: { mode: 'create_each_run' }, enabled: true, nextRunAt: null, createdAt: 0, updatedAt: 0, lastRun: null,
} as never
const tree = [{ name: '运营', children: [{ name: '监控' }, { name: '报告' }] }, { name: '工程', children: [{ name: '文档' }] }]
const baseProps = { automation: auto, projects: [], categoryTree: tree, onOpenCategoryManager: vi.fn(), onClose: vi.fn(), onSaved: vi.fn() }

test('标题只读显示任务名，无提示词输入框', () => {
  render(<AutomationSettingsModal {...baseProps} />)
  const title = screen.getByDisplayValue('晨间竞品监控') as HTMLInputElement
  expect(title.readOnly).toBe(true)
  expect(screen.queryByPlaceholderText(/无人值守/)).toBeNull()  // 旧 prompt textarea 已移除
})
test('触发器 pill 摘要拼接所有触发点', () => {
  render(<AutomationSettingsModal {...baseProps} />)
  expect(screen.getByText('启动时 · 每天 09:00 · 上海')).toBeInTheDocument()
})
test('执行方式默认 Agent 执行', () => {
  render(<AutomationSettingsModal {...baseProps} />)
  expect(screen.getByText('Agent 执行')).toBeInTheDocument()
})
test('分类 pill 显示当前层级路径', () => {
  render(<AutomationSettingsModal {...baseProps} />)
  expect(screen.getByText('运营 › 监控')).toBeInTheDocument()
})
test('配置区列出声明的 env + 未绑定标志', async () => {
  render(<AutomationSettingsModal {...baseProps} />)
  expect(await screen.findByText('COMPETITOR_API_KEY')).toBeInTheDocument()
  expect(screen.getByText('未绑定')).toBeInTheDocument()
})
test('保存提交新字段 body，不含 prompt', async () => {
  render(<AutomationSettingsModal {...baseProps} />)
  await userEvent.click(screen.getByRole('button', { name: '保存设置' }))
  expect(patch).toHaveBeenCalledWith('mon', expect.objectContaining({
    category: ['运营', '监控'], tags: ['监控', '竞品'],
    triggers: [{ kind: 'startup' }, { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }],
    executor: 'agent', target: { mode: 'create_each_run' },
    engine: 'claude', model: 'opus', permission: 'bypassPermissions',
  }))
  expect(patch.mock.calls[0][1]).not.toHaveProperty('prompt')
})
