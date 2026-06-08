import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { Home } from '../Home'

const noop = () => {}
const baseProps = {
  projects: [], onSend: noop, onOpenProject: noop, onViewAll: noop,
  skillCount: 0, onOpenSkillModal: noop,
}
// composerSeed = 统一的「塞首页 composer」入口（Integrations 安装、自动化 agent-led 新建/编辑都走它）
test('composerSeed 注入 hero-input 并回调消费', () => {
  const onSeedConsumed = vi.fn()
  render(<Home {...baseProps} composerSeed="帮我新建一个定时任务" onSeedConsumed={onSeedConsumed} />)
  expect(screen.getByRole('textbox')).toHaveValue('帮我新建一个定时任务')
  expect(onSeedConsumed).toHaveBeenCalled()
})
test('无 composerSeed 时 hero-input 为空', () => {
  render(<Home {...baseProps} />)
  expect(screen.getByRole('textbox')).toHaveValue('')
})
