import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { probeSkills } from '../probe'
import { parseSkillFrontmatter } from '../frontmatter'

// 真实内置技能源目录（build.mjs 会原样拷进打包）
const BUILTIN_DIR = path.resolve(__dirname, '../../builtin-skills')

describe('cli-tools-manager 内置 skill', () => {
  it('被 probe 识别为一个 skill', () => {
    const probed = probeSkills(BUILTIN_DIR)
    const cli = probed.find((p) => p.name === 'cli-tools-manager')
    expect(cli).toBeTruthy()
  })

  it('frontmatter autoInject 种子为 true', () => {
    const md = fs.readFileSync(path.join(BUILTIN_DIR, 'cli-tools-manager', 'SKILL.md'), 'utf8')
    const fm = parseSkillFrontmatter(md)
    expect(fm.name).toBe('cli-tools-manager')
    expect(fm.autoInject).toBe(true)
  })

  it('正文指引走 as_cli_* 工具（不自己跑安装脚本）', () => {
    const md = fs.readFileSync(path.join(BUILTIN_DIR, 'cli-tools-manager', 'SKILL.md'), 'utf8')
    // spec §A.9 SKILL.md 逐字提及的工具（as_cli_remove 移除自定义较少用，预装提示词未列入）
    for (const tool of ['as_cli_list', 'as_cli_install', 'as_cli_add', 'as_cli_check_updates', 'as_cli_update']) {
      expect(md).toContain(tool)
    }
  })
})
