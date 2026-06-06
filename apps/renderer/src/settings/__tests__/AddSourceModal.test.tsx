import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { AddSourceModal } from '../AddSourceModal'

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: {
    addSkillSource: vi.fn().mockResolvedValue({
      source: { id: 's1', type: 'folder', name: 'skills', loc: '/test/path', updateMode: 'manual', sortIndex: 0 },
    }),
    patchSkillSource: vi.fn().mockResolvedValue({
      source: { id: 's1', type: 'folder', name: 'skills', loc: '/test/path', updateMode: 'manual', sortIndex: 0 },
    }),
  },
}))

test('kind="folder" 渲染文件夹路径输入框和选择按钮', () => {
  render(<AddSourceModal kind="folder" onSaved={vi.fn()} onClose={vi.fn()} />)
  expect(screen.getByPlaceholderText(/my-skills/)).toBeInTheDocument()
  expect(screen.getByRole('button', { name: '选择…' })).toBeInTheDocument()
})

test('kind="git" 渲染托管平台 select + 仓库地址 input + 私有库 toggle', () => {
  render(<AddSourceModal kind="git" onSaved={vi.fn()} onClose={vi.fn()} />)
  // 托管平台 select
  expect(screen.getByRole('combobox')).toBeInTheDocument()
  // 仓库地址 input
  expect(screen.getByPlaceholderText(/github.com\/owner\/repo/)).toBeInTheDocument()
  // 私有库 toggle button（aria role=button, not the select/submit buttons）
  const toggleBtns = screen.getAllByRole('button')
  // 至少有「取消」「探测并添加」和 toggle 按钮
  expect(toggleBtns.length).toBeGreaterThanOrEqual(3)
})

test('kind="git" 选 CNB + 开启私有库 → 显示「Git 用户名」而非「Personal Access Token」', async () => {
  render(<AddSourceModal kind="git" onSaved={vi.fn()} onClose={vi.fn()} />)
  // 切换平台到 CNB
  await userEvent.selectOptions(screen.getByRole('combobox'), 'cnb')
  // 开启私有库 toggle（toggle 按钮排在第一个非 modal-close 按钮位置，找 toggle on/off）
  // 找到 class 含 toggle 的按钮
  const toggleBtn = document.querySelector('.toggle') as HTMLElement
  expect(toggleBtn).toBeTruthy()
  await userEvent.click(toggleBtn)

  // userFirst=true (cnb) → 显示「Git 用户名」
  expect(screen.getByText('Git 用户名')).toBeInTheDocument()
  // userFirst=true → 不显示「Personal Access Token」
  expect(screen.queryByText('Personal Access Token')).not.toBeInTheDocument()
})

test('kind="folder" 填路径后点「探测并添加」→ api.addSkillSource 以 { type:"folder", loc } 调用', async () => {
  const onSaved = vi.fn()
  render(<AddSourceModal kind="folder" onSaved={onSaved} onClose={vi.fn()} />)
  await userEvent.type(screen.getByPlaceholderText(/my-skills/), '/my/skill/dir')
  await userEvent.click(screen.getByText('探测并添加'))

  const { api } = await import('../../api/client') as any
  expect(api.addSkillSource).toHaveBeenCalledWith(
    expect.objectContaining({ type: 'folder', loc: '/my/skill/dir' })
  )
})

test('编辑私有 git 源：token 留空 → patchSkillSource 不带 token（保持原值）', async () => {
  const existing = { id: 'g1', type: 'git', name: 'o/r', loc: 'cnb.cool/o/r', provider: 'cnb', branch: 'main', private: true, user: 'cnb', updateMode: 'manual', sortIndex: 0 }
  const { api } = await import('../../api/client') as any
  ;(api.patchSkillSource as any).mockResolvedValue({ source: existing })
  render(<AddSourceModal kind="git" existing={existing as any} onSaved={vi.fn()} onClose={vi.fn()} />)
  // 不动 token 字段（留空），直接保存
  await userEvent.click(screen.getByText('保存'))
  await waitFor(() => expect(api.patchSkillSource).toHaveBeenCalled())
  const [, body] = (api.patchSkillSource as any).mock.calls[0]
  expect('token' in body).toBe(false)   // 留空 = 保持，绝不发 token（否则会抹掉凭据）
})

test('编辑 git 源转公开 → 清空 token/user（发空串）', async () => {
  const existing = { id: 'g1', type: 'git', name: 'o/r', loc: 'cnb.cool/o/r', provider: 'cnb', branch: 'main', private: true, user: 'cnb', updateMode: 'manual', sortIndex: 0 }
  const { api } = await import('../../api/client') as any
  ;(api.patchSkillSource as any).mockClear()
  ;(api.patchSkillSource as any).mockResolvedValue({ source: existing })
  render(<AddSourceModal kind="git" existing={existing as any} onSaved={vi.fn()} onClose={vi.fn()} />)
  // 关掉私有库开关（找到 .src-toggle-row 里的 .toggle 按钮并点击）
  const toggle = document.querySelector('.src-toggle-row .toggle') as HTMLElement
  expect(toggle).toBeTruthy()
  await userEvent.click(toggle)
  await userEvent.click(screen.getByText('保存'))
  await waitFor(() => expect(api.patchSkillSource).toHaveBeenCalled())
  const [, body] = (api.patchSkillSource as any).mock.calls[0]
  expect(body.token).toBe('')
  expect(body.user).toBe('')
})
