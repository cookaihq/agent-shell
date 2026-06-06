import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { SkillRow } from '../SkillRow'

const SKILL_MD = '---\nname: guizang-ppt\ndescription: 生成杂志风格演示 deck\n---\n# 正文'

describe('SkillRow', () => {
  it('头行：技能名 + 「技能」标签 + 描述(来自 result frontmatter) + 耗时', () => {
    const { container } = render(
      <SkillRow input={{ skill: 'guizang-ppt', args: '主题=种子轮' }} resultContent={SKILL_MD} startedAt={1000} completedAt={1003} />,
    )
    expect(container.querySelector('.sk-line .sk-name')?.textContent).toBe('guizang-ppt')
    expect(screen.getByText('技能')).toBeInTheDocument()
    expect(screen.getByText('生成杂志风格演示 deck')).toBeInTheDocument()
    expect(container.querySelector('.sk-t')?.textContent).toBe('3ms')
  })

  it('有 args → 参数折叠（收起预览 ska-prev + 展开 ska-full/ska-less）', () => {
    const { container } = render(<SkillRow input={{ skill: 's', args: '主题=x' }} />)
    expect(container.querySelector('.sk-args .ska-prev')?.textContent).toContain('主题=x')
    expect(container.querySelector('.sk-args .ska-full .ska-less')?.textContent).toBe('收起')
  })

  it('无 args → 不渲染 sk-args；无 resultContent → 不渲染 sk-desc', () => {
    const { container } = render(<SkillRow input={{ skill: 's' }} />)
    expect(container.querySelector('.sk-args')).toBeNull()
    expect(container.querySelector('.sk-desc')).toBeNull()
  })

  it('对象 args → JSON 序列化后单行预览', () => {
    const { container } = render(<SkillRow input={{ skill: 's', args: { 主题: '种子轮', 页数: 12 } }} />)
    const prev = container.querySelector('.sk-args .ska-prev')?.textContent ?? ''
    expect(prev).toContain('"主题"')
    expect(prev).toContain('种子轮')
    expect(prev).toContain('12')
    // 多行 JSON 被折叠成单行（无换行）
    expect(prev.includes('\n')).toBe(false)
  })
})
