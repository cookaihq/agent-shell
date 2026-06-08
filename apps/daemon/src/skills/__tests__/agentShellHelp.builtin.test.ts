import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { probeSkills } from '../probe'
import { parseSkillFrontmatter } from '../frontmatter'

// 真实内置技能源目录（build.mjs 会原样拷进打包）
const BUILTIN_DIR = path.resolve(__dirname, '../../builtin-skills')

describe('agent-shell-help 内置 skill', () => {
  it('被 probe 识别为一个 skill', () => {
    const probed = probeSkills(BUILTIN_DIR)
    const help = probed.find((p) => p.name === 'agent-shell-help')
    expect(help).toBeTruthy()
  })

  it('frontmatter autoInject 种子为 true', () => {
    const md = fs.readFileSync(path.join(BUILTIN_DIR, 'agent-shell-help', 'SKILL.md'), 'utf8')
    const fm = parseSkillFrontmatter(md)
    expect(fm.name).toBe('agent-shell-help')
    expect(fm.autoInject).toBe(true)
  })

  it('references 目录随 skill 存在（多文件）', () => {
    const refs = fs.readdirSync(path.join(BUILTIN_DIR, 'agent-shell-help', 'references'))
    expect(refs).toContain('overview.md')
    expect(refs.length).toBeGreaterThanOrEqual(6)
  })
})
