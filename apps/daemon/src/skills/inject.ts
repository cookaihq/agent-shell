import fs from 'node:fs'
import path from 'node:path'

/** 建项目时把选中技能软链进 <project>/.claude/skills（仅 claude，D6）。
 *  跨平台：posix 用 'dir'，win32 用 'junction'（无需提权）。库中缺失的技能名跳过。 */
export function injectClaudeSkills(projectPath: string, skillsDir: string, names: string[]): void {
  const valid = names.filter((n) => fs.existsSync(path.join(skillsDir, n, 'SKILL.md')))
  if (valid.length === 0) return
  const dest = path.join(projectPath, '.claude', 'skills')
  fs.mkdirSync(dest, { recursive: true })
  const linkType = process.platform === 'win32' ? 'junction' : 'dir'
  for (const name of valid) {
    const link = path.join(dest, name)
    if (fs.existsSync(link)) continue
    fs.symlinkSync(path.join(skillsDir, name), link, linkType)
  }
}
