import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { Skill } from '@agent-shell/contracts'
import { parseSkillFrontmatter } from './frontmatter'

export class SkillError extends Error {
  constructor(public reason: 'no_skill_md' | 'invalid_url' | 'exists' | 'not_found' | 'not_git' | 'git_failed', message: string) {
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

/** 复制本地文件夹（含 SKILL.md）进库。 */
export function importFolderSkill(libDir: string, srcPath: string): Skill {
  if (!fs.existsSync(srcPath) || !fs.statSync(srcPath).isDirectory()) throw new SkillError('not_found', '文件夹不存在')
  if (!hasSkillMd(srcPath)) throw new SkillError('no_skill_md', '所选文件夹未找到 SKILL.md')
  const name = path.basename(srcPath.replace(/\/+$/, ''))
  const dest = path.join(libDir, name)
  if (fs.existsSync(dest)) throw new SkillError('exists', `技能「${name}」已存在`)
  fs.mkdirSync(libDir, { recursive: true })
  fs.cpSync(srcPath, dest, { recursive: true, dereference: true })
  return readSkill(libDir, name)
}

/** git clone 仓库进库，校验含 SKILL.md。 */
export function importGitSkill(libDir: string, url: string): Skill {
  if (!/^(https?:\/\/|git@).+/.test(url)) throw new SkillError('invalid_url', '请输入有效的 Git 仓库地址')
  const name = (url.split('/').pop() ?? 'skill').replace(/\.git$/, '')
  const dest = path.join(libDir, name)
  if (fs.existsSync(dest)) throw new SkillError('exists', `技能「${name}」已存在`)
  fs.mkdirSync(libDir, { recursive: true })
  try { execFileSync('git', ['clone', '--depth', '1', url, dest], { encoding: 'utf8', timeout: 60000 }) }
  catch (e) { throw new SkillError('git_failed', 'git clone 失败：' + (e as Error).message) }
  if (!hasSkillMd(dest)) { fs.rmSync(dest, { recursive: true, force: true }); throw new SkillError('no_skill_md', '仓库未找到 SKILL.md') }
  return readSkill(libDir, name)
}

export function removeSkill(libDir: string, name: string): void {
  const dir = path.join(libDir, name)
  if (!fs.existsSync(dir)) throw new SkillError('not_found', '技能不存在')
  fs.rmSync(dir, { recursive: true, force: true })
}

/** git pull 更新（仅 git 来源）。 */
export function updateSkill(libDir: string, name: string): Skill {
  const dir = path.join(libDir, name)
  if (!fs.existsSync(dir)) throw new SkillError('not_found', '技能不存在')
  if (!fs.existsSync(path.join(dir, '.git'))) throw new SkillError('not_git', '非 Git 来源，无法更新')
  try { execFileSync('git', ['-C', dir, 'pull', '--ff-only'], { encoding: 'utf8', timeout: 60000 }) }
  catch (e) { throw new SkillError('git_failed', 'git pull 失败：' + (e as Error).message) }
  return readSkill(libDir, name)
}
