import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { probeSkills } from '../probe'

// 真实内置 skill 目录（pnpm test 自 worktree 根运行）
const BUILTIN_SKILLS = path.join(process.cwd(), 'apps/daemon/src/builtin-skills')

describe('内置 create-automation skill', () => {
  it('在 builtin-skills 目录可被 probe 到，frontmatter 有效', () => {
    const found = probeSkills(BUILTIN_SKILLS)
    const ca = found.find((p) => p.name === 'create-automation')
    expect(ca).toBeTruthy()
    // description 应教 agent 用 as_create_automation 工具
    expect(ca!.desc).toContain('as_create_automation')
  })
})
