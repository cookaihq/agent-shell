import { describe, it, expect } from 'vitest'
import { parseSkillFrontmatter } from '../frontmatter'

describe('parseSkillFrontmatter', () => {
  it('行内 name + 块标量 description（真实 humanizer 形状）', () => {
    const md = ['---', 'name: humanizer', 'version: 2.5.1', 'description: |', '  Remove signs of AI writing.', '  Use when editing text.', '---', '', '# 正文'].join('\n')
    const fm = parseSkillFrontmatter(md)
    expect(fm.name).toBe('humanizer')
    expect(fm.description).toBe('Remove signs of AI writing. Use when editing text.')
  })
  it('行内 description', () => {
    const md = ['---', 'name: brand-asset', 'description: 品牌资产与视觉规范', '---'].join('\n')
    expect(parseSkillFrontmatter(md)).toEqual({ name: 'brand-asset', description: '品牌资产与视觉规范' })
  })
  it('无 frontmatter → 空对象', () => {
    expect(parseSkillFrontmatter('# 只有正文')).toEqual({})
  })
})
