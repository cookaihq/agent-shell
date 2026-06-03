import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi, afterEach } from 'vitest'
import { SystemSettings } from '../SystemSettings'

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, api: {
  getConfig: vi.fn().mockResolvedValue({ projectsDir: '~/AgentShell/projects', skillsDir: '~/.agent-shell/skills' }),
  saveConfig: vi.fn().mockResolvedValue({ projectsDir: '/new/p', skillsDir: '~/.agent-shell/skills' }),
} }))

test('载入 config 到输入框 + 改父级目录保存', async () => {
  render(<SystemSettings />)
  const input = await screen.findByDisplayValue('~/AgentShell/projects')
  await userEvent.clear(input); await userEvent.type(input, '/new/p')
  await userEvent.click(screen.getByText('保存'))
  const { api } = await import('../../api/client') as any
  expect(api.saveConfig).toHaveBeenCalledWith(expect.objectContaining({ projectsDir: '/new/p' }))
})

test('有桌面桥时，点「更改…」调 pickFolder 并填入项目目录', async () => {
  const { api } = await import('../../api/client') as any
  api.getConfig.mockResolvedValueOnce({ projectsDir: '', skillsDir: '' })

  const pickFolder = vi.fn().mockResolvedValue('/picked/projects')
  window.agentShell = { authToken: '', pickFolder } as any

  render(<SystemSettings />)
  // 等待组件挂载并触发 getConfig（两个输入都为空串，等任意一个出现即可）
  await screen.findAllByDisplayValue('')

  const buttons = screen.getAllByRole('button', { name: '更改…' })
  await userEvent.click(buttons[0])

  expect(pickFolder).toHaveBeenCalled()
  expect(screen.getAllByDisplayValue('/picked/projects').length).toBeGreaterThan(0)

  delete (window as any).agentShell
})
