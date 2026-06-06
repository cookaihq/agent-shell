import fs from 'node:fs'; import path from 'node:path'
import { parseSkillFrontmatter } from './frontmatter'

export interface ProbedRaw { name: string; relPath: string; desc: string }

const hasSkillMd = (dir: string) => fs.existsSync(path.join(dir, 'SKILL.md'))

function read(dir: string, root: string): ProbedRaw {
  const rel = path.relative(root, dir)
  const fm = parseSkillFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'))
  const relPath = rel === '' ? '' : rel.split(path.sep).join('/') + '/'
  return { name: fm.name?.trim() || (path.basename(dir) || 'skill'), relPath, desc: fm.description ?? '' }
}

/** spec §4：根有 SKILL.md → 整目录 1 个；否则逐级递归，每条路径遇第一个 SKILL.md 即停。
 *  忽略 .git / node_modules / 隐藏目录。深度上限 6 防深树。 */
export function probeSkills(rootDir: string, maxDepth = 6): ProbedRaw[] {
  if (!fs.existsSync(rootDir) || !fs.statSync(rootDir).isDirectory()) return []
  if (hasSkillMd(rootDir)) return [read(rootDir, rootDir)]
  const out: ProbedRaw[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > maxDepth) return
    let ents: fs.Dirent[]
    try { ents = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of ents) {
      if (!e.isDirectory() && !e.isSymbolicLink()) continue
      if (e.name.startsWith('.') || e.name === 'node_modules') continue
      const child = path.join(dir, e.name)
      if (hasSkillMd(child)) out.push(read(child, rootDir))   // 命中即停（不进内部）
      else walk(child, depth + 1)
    }
  }
  walk(rootDir, 1)
  return out.sort((a, b) => a.relPath.localeCompare(b.relPath))
}
