import { readFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import path from 'node:path'
import os from 'node:os'

/** 本机 claude 登录态。email 仅 OAuth 可能携带——但本地凭证不含 email，固定 undefined。 */
export type ClaudeLoginState =
  | { status: 'signed-out' }
  | { status: 'signed-in'; method: 'oauth'; email?: string }
  | { status: 'signed-in'; method: 'api_key' }

/**
 * 纯函数：按凭证文件内容判定登录态。形状无关来源——
 * macOS 的 keychain blob 与其他平台的 .credentials.json 内容同形，塞进同一个 key 即可复用。
 * 判据见 probe-notes.md：claudeAiOauth.accessToken → oauth；顶层 apiKey → api_key；其余 signed-out。
 */
export function detectClaudeLoginFromFiles(files: Record<string, string>): ClaudeLoginState {
  const cred = files['.credentials.json']
  if (!cred) return { status: 'signed-out' }
  let parsed: { claudeAiOauth?: { accessToken?: string }; apiKey?: string }
  try {
    parsed = JSON.parse(cred)
  } catch {
    return { status: 'signed-out' }
  }
  if (parsed?.claudeAiOauth?.accessToken) {
    // 本地凭证无 email 字段（见 probe-notes.md）——硬编码 undefined 守住契约，
    // 不从本地凭证取 email（email 只在 Phase 4 OAuth 换 token 时由别处填充）。
    return { status: 'signed-in', method: 'oauth', email: undefined }
  }
  if (parsed?.apiKey) return { status: 'signed-in', method: 'api_key' }
  return { status: 'signed-out' }
}

/**
 * 薄封装：从本机读 claude 凭证后调纯函数。分平台——
 * - macOS：凭证在 Keychain（service=`Claude Code-credentials`），用 security 命令读；item 不存在时命令会抛 → 视为未登录。
 * - 其他平台：读 ~/.claude/.credentials.json。
 * 任一读取/执行异常或为空 → signed-out。检测绝不抛。
 */
export function detectClaudeLogin(home = os.homedir()): ClaudeLoginState {
  let cred = ''
  try {
    if (process.platform === 'darwin') {
      cred = execFileSync(
        'security',
        ['find-generic-password', '-s', 'Claude Code-credentials', '-w'],
        { encoding: 'utf8' },
      ).trim()
    } else {
      const file = path.join(home, '.claude', '.credentials.json')
      if (existsSync(file)) cred = readFileSync(file, 'utf8').trim()
    }
  } catch {
    return { status: 'signed-out' }
  }
  if (!cred) return { status: 'signed-out' }
  return detectClaudeLoginFromFiles({ '.credentials.json': cred })
}
