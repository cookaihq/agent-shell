import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Skill } from '@agent-shell/contracts'
import { parseSkillFrontmatter } from './frontmatter'

export class SkillError extends Error {
  constructor(public reason: 'no_skill_md' | 'invalid_url' | 'exists' | 'not_found' | 'not_git' | 'git_failed' | 'forbidden', message: string) {
    super(message); this.name = 'SkillError'
  }
}

const hasSkillMd = (dir: string): boolean => fs.existsSync(path.join(dir, 'SKILL.md'))

function readSkill(libDir: string, name: string): Skill {
  const dir = path.join(libDir, name)
  const fm = parseSkillFrontmatter(fs.readFileSync(path.join(dir, 'SKILL.md'), 'utf8'))
  const isGit = fs.existsSync(path.join(dir, '.git'))
  let origin = ''
  if (isGit) {
    try { origin = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8' }).trim() } catch { origin = '' }
  }
  return { name, source: isGit ? 'git' : 'folder', origin, desc: fm.description ?? '' }
}

/** 扫描技能库目录：每个含 SKILL.md 的子目录 = 一个技能。 */
export function scanSkills(libDir: string): Skill[] {
  let entries: fs.Dirent[]
  try { entries = fs.readdirSync(libDir, { withFileTypes: true }) } catch { return [] }
  return entries
    .filter((e) => (e.isDirectory() || e.isSymbolicLink()) && hasSkillMd(path.join(libDir, e.name)))
    .map((e) => readSkill(libDir, e.name))
    .sort((a, b) => a.name.localeCompare(b.name))
}

