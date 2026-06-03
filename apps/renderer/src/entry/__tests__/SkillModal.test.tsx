import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { SkillModal } from '../SkillModal'

vi.mock('../../api/client', () => ({ ApiError: class extends Error {}, api: {
  listSkills: vi.fn().mockResolvedValue({ skills: [
    { name: 'guizang-ppt', source: 'git', origin: 'x', desc: '杂志风 deck' },
    { name: 'brand-asset', source: 'folder', origin: '', desc: '品牌资产' },
  ] }),
} }))

test('读真实技能库 + 搜索 + 多选完成回传', async () => {
  const onDone = vi.fn()
  render(<SkillModal initialSelected={[]} onClose={vi.fn()} onDone={onDone} />)
  expect(await screen.findByText('guizang-ppt')).toBeInTheDocument()
  await userEvent.type(screen.getByPlaceholderText('搜索技能…'), 'brand')
  expect(screen.queryByText('guizang-ppt')).not.toBeInTheDocument()
  await userEvent.click(screen.getByText('brand-asset').closest('.si-row')!)
  await userEvent.click(screen.getByText('完成'))
  expect(onDone).toHaveBeenCalledWith(['brand-asset'])
})
