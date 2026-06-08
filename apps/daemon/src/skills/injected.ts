import fs from 'node:fs'
import path from 'node:path'

/** 列出某项目已注入的技能名（= <project>/.claude/skills 下的目录/软链名）。
 *  与 injectClaudeSkills 的落点对称；目录不存在 → []。名称即技能 effectiveName，entityRef = 'skill:'+name。 */
export function listInjectedSkills(projectPath: string): string[] {
  const dir = path.join(projectPath, '.claude', 'skills')
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] }
  return entries
    .filter((e) => e.isDirectory() || e.isSymbolicLink())
    .map((e) => e.name)
    .sort()
}
