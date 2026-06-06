import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { SkillModal } from '../SkillModal'

vi.mock('../../api/client', () => ({
  ApiError: class extends Error {},
  api: { listSkillLibrary: vi.fn() },
}))
import { api } from '../../api/client'

const LIB = [
  { effectiveName: 'pdf', name: 'pdf', desc: 'PDF 工具', sourceId: 'a', sourceName: 'anthropics', globalIn: ['claude'] as const },
  { effectiveName: 'brainstorming', name: 'brainstorming', desc: '打磨想法', sourceId: 'b', sourceName: 'superpowers', globalIn: [] as const },
]

describe('SkillModal（注入技能=技能库 + 覆盖预警）', () => {
  beforeEach(() => {
    ;(api.listSkillLibrary as ReturnType<typeof vi.fn>).mockResolvedValue({ skills: LIB })
  })

  it('渲染库内技能；globalIn 非空行有覆盖预警 .si-shadow', async () => {
    render(<SkillModal initialSelected={[]} onClose={() => {}} onDone={() => {}} />)
    expect(await screen.findByText('pdf')).toBeInTheDocument()
    expect(screen.getByText('brainstorming')).toBeInTheDocument()
    const shadow = document.querySelector('.si-shadow') as HTMLElement
    expect(shadow).toBeTruthy()
    expect(shadow.getAttribute('title') || '').toContain('覆盖')
  })

  it('多选 → onDone 回传 effectiveName 数组', async () => {
    const onDone = vi.fn()
    render(<SkillModal initialSelected={[]} onClose={() => {}} onDone={onDone} />)
    fireEvent.click(await screen.findByText('pdf'))
    fireEvent.click(screen.getByText('完成'))
    expect(onDone).toHaveBeenCalledWith(['pdf'])
  })

  it('initialSelected 预填 sel；onDone 包含预选项', async () => {
    const onDone = vi.fn()
    render(<SkillModal initialSelected={['brainstorming']} onClose={() => {}} onDone={onDone} />)
    await screen.findByText('pdf')
    fireEvent.click(screen.getByText('完成'))
    expect(onDone).toHaveBeenCalledWith(['brainstorming'])
  })

  it('globalIn 为空的行没有 .si-shadow 徽章（仅一个 shadow）', async () => {
    render(<SkillModal initialSelected={[]} onClose={() => {}} onDone={() => {}} />)
    await screen.findByText('brainstorming')
    const shadows = document.querySelectorAll('.si-shadow')
    expect(shadows).toHaveLength(1)
  })
})
