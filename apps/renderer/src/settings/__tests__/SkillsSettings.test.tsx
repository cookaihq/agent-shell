import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { SkillsSettings } from '../SkillsSettings'

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, api: {
  listSkills: vi.fn().mockResolvedValue({ skills: [
    { name: 'guizang-ppt', source: 'git', origin: 'github.com/x/ppt', desc: '杂志风 deck' },
    { name: 'brand-asset', source: 'folder', origin: '', desc: '品牌资产' },
  ] }),
  deleteSkill: vi.fn().mockResolvedValue({ ok: true }),
  updateSkill: vi.fn().mockResolvedValue({ skill: { name: 'guizang-ppt', source: 'git', origin: '', desc: '杂志风 deck' } }),
} }))

test('渲染技能行 + 搜索过滤 + git 行有更新按钮 + 删除', async () => {
  render(<SkillsSettings />)
  expect(await screen.findByText('guizang-ppt')).toBeInTheDocument()
  expect(screen.getByText('brand-asset')).toBeInTheDocument()
  await userEvent.type(screen.getByPlaceholderText('搜索技能…'), 'brand')
  expect(screen.queryByText('guizang-ppt')).not.toBeInTheDocument()
  expect(screen.getByText('brand-asset')).toBeInTheDocument()
})
