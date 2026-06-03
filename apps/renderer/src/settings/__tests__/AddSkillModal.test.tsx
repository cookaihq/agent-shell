import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { AddSkillModal } from '../AddSkillModal'

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, api: {
  importSkill: vi.fn().mockResolvedValue({ skill: { name: 'ppt-skill', source: 'git', origin: 'x', desc: '' } }),
} }))

test('Git 导入：非法地址报错 + 合法地址调 importSkill', async () => {
  const onImported = vi.fn(), onClose = vi.fn()
  render(<AddSkillModal onImported={onImported} onClose={onClose} />)
  await userEvent.click(screen.getByText('导入'))
  expect(screen.getByText(/有效的 Git/)).toBeInTheDocument()
  await userEvent.type(screen.getByPlaceholderText(/github.com/), 'https://github.com/x/ppt-skill.git')
  await userEvent.click(screen.getByText('导入'))
  const { api } = await import('../../api/client') as any
  expect(api.importSkill).toHaveBeenCalledWith({ source: 'git', url: 'https://github.com/x/ppt-skill.git' })
})
test('切到文件夹：输入路径导入', async () => {
  render(<AddSkillModal onImported={vi.fn()} onClose={vi.fn()} />)
  await userEvent.click(screen.getByText('导入文件夹'))
  await userEvent.type(screen.getByPlaceholderText(/绝对路径|\/path|文件夹/), '/abs/skill')
  await userEvent.click(screen.getByText('导入'))
  const { api } = await import('../../api/client') as any
  expect(api.importSkill).toHaveBeenCalledWith({ source: 'folder', path: '/abs/skill' })
})

test('有桌面桥时，文件夹模式点「选择文件夹…」调 pickFolder 并填入路径', async () => {
  const pickFolder = vi.fn().mockResolvedValue('/picked/skill')
  window.agentShell = { authToken: '', pickFolder } as any

  render(<AddSkillModal onImported={vi.fn()} onClose={vi.fn()} />)
  await userEvent.click(screen.getByText('导入文件夹'))
  await userEvent.click(screen.getByRole('button', { name: '选择文件夹…' }))

  expect(pickFolder).toHaveBeenCalled()
  expect(screen.getByDisplayValue('/picked/skill')).toBeInTheDocument()

  delete (window as any).agentShell
})
