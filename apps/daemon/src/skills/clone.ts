import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import type { SkillSourceDef } from '@agent-shell/contracts'
import { SkillError } from './store'

/** 归一化仓库地址（去协议/去 .git/去尾斜杠）→ host/owner/repo。 */
function normLoc(loc: string): string {
  return loc.replace(/^https?:\/\//, '').replace(/\/+$/, '').replace(/\.git$/, '')
}

/** 拼 clone 用 https url。私有库注入凭据：有 user→user:token@；无 user（github/gitlab PAT）→ x-access-token:token@。 */
export function buildAuthUrl(s: Pick<SkillSourceDef, 'loc' | 'private' | 'user' | 'token'>): string {
  const host = normLoc(s.loc)
  if (!s.private || !s.token) return `https://${host}.git`
  const user = encodeURIComponent(s.user || 'x-access-token')
  const token = encodeURIComponent(s.token)
  return `https://${user}:${token}@${host}.git`
}

/** clone（首次）或 pull（缓存已存在）到 cacheDir/<sourceId>。返回工作树目录。失败抛 SkillError('git_failed')。 */
export function cloneOrPull(s: SkillSourceDef, cacheRoot: string): string {
  const dest = path.join(cacheRoot, s.id)
  const url = buildAuthUrl(s)
  const branchArgs = s.branch ? ['--branch', s.branch] : []
  try {
    if (fs.existsSync(path.join(dest, '.git'))) {
      execFileSync('git', ['-C', dest, 'pull', '--ff-only'], { encoding: 'utf8', timeout: 120000 })
    } else {
      fs.mkdirSync(cacheRoot, { recursive: true })
      execFileSync('git', ['clone', '--depth', '1', ...branchArgs, url, dest], { encoding: 'utf8', timeout: 120000 })
    }
  } catch (e) {
    throw new SkillError('git_failed', 'git 操作失败：' + (e as Error).message)
  }
  return dest
}
