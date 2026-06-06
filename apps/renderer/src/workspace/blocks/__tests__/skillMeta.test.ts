import { describe, it, expect } from 'vitest'
import { parseSkillFrontmatter } from '../skillMeta'

describe('parseSkillFrontmatter', () => {
  it('解析行内 name/description', () => {
    expect(parseSkillFrontmatter('---\nname: guizang-ppt\ndescription: 生成杂志风格演示 deck\n---\n# body'))
      .toEqual({ name: 'guizang-ppt', description: '生成杂志风格演示 deck' })
  })
  it('支持 | 块标量 description', () => {
    const md = '---\nname: a\ndescription: |\n  第一行\n  第二行\n---'
    expect(parseSkillFrontmatter(md).description).toBe('第一行 第二行')
  })
  it('无 frontmatter → 空对象', () => {
    expect(parseSkillFrontmatter('# 只有正文')).toEqual({})
  })
})
