import { readFileSync, existsSync } from 'node:fs'
import path from 'node:path'
import os from 'node:os'

/** 本机 codex 登录态。与 ClaudeLoginState 同形（→ 同一 CliLoginStatus 契约）。
 *  email 仅 chatgpt OAuth 可能携带（从 id_token 解出），apikey 态无 email。 */
export type CodexLoginState =
  | { status: 'signed-out' }
  | { status: 'signed-in'; method: 'oauth'; email?: string }
  | { status: 'signed-in'; method: 'api_key' }

/** 从 JWT 的 payload 段尽力解出 email（base64url → JSON → .email）。失败/无则 undefined，绝不抛。 */
function emailFromIdToken(idToken: unknown): string | undefined {
  if (typeof idToken !== 'string') return undefined
  const seg = idToken.split('.')[1]
  if (!seg) return undefined
  try {
    const payload = JSON.parse(Buffer.from(seg, 'base64url').toString('utf8')) as { email?: unknown }
    return typeof payload?.email === 'string' && payload.email ? payload.email : undefined
  } catch {
    return undefined
  }
}

/**
 * 纯函数：按 ~/.codex 凭证文件内容判定登录态（与 detectClaudeLoginFromFiles 对称）。
 * 判据见 probe-notes.md §6（0.137 实测）+ codex auth.json 真机形态：
 *   - chatgpt OAuth 登录：auth.json 有 `tokens` 对象（{id_token, access_token, refresh_token, account_id}）→ oauth；
 *     email 从 tokens.id_token JWT 的 email 声明尽力解出（无则 undefined，契约允许）。
 *     ⚠️ tokens 优先于 OPENAI_API_KEY——chatgpt 态 auth.json 也可能残留旧 key 字段，但语义是 oauth。
 *   - apikey 登录：auth.json 仅顶层 `OPENAI_API_KEY` 非空（真机实测形态 `{ "OPENAI_API_KEY": "sk-..." }`）→ api_key。
 *   - 其余（无文件 / 解析失败 / 两者皆无）→ signed-out。
 */
export function detectCodexLoginFromFiles(files: Record<string, string>): CodexLoginState {
  const raw = files['auth.json']
  if (!raw) return { status: 'signed-out' }
  let parsed: { OPENAI_API_KEY?: unknown; tokens?: { id_token?: unknown } | null }
  try {
    parsed = JSON.parse(raw)
  } catch {
    return { status: 'signed-out' }
  }
  // chatgpt OAuth 优先：tokens 对象在场即判 oauth（即便旧 OPENAI_API_KEY 残留）
  if (parsed?.tokens && typeof parsed.tokens === 'object') {
    return { status: 'signed-in', method: 'oauth', email: emailFromIdToken(parsed.tokens.id_token) }
  }
  if (typeof parsed?.OPENAI_API_KEY === 'string' && parsed.OPENAI_API_KEY) {
    return { status: 'signed-in', method: 'api_key' }
  }
  return { status: 'signed-out' }
}

/**
 * 薄封装：从本机 ~/.codex/auth.json 读凭证后调纯函数。
 * codex 凭证统一落 `$CODEX_HOME/auth.json`（缺省 ~/.codex）——不像 claude 分平台（codex 不用 keychain）。
 * 文件不存在/读失败/为空 → signed-out。检测绝不抛。
 * @param home 用户 home（测试注入）；codexHome 缺省 = home/.codex。
 */
export function detectCodexLogin(home = os.homedir(), codexHome = path.join(home, '.codex')): CodexLoginState {
  let raw = ''
  try {
    const file = path.join(codexHome, 'auth.json')
    if (existsSync(file)) raw = readFileSync(file, 'utf8').trim()
  } catch {
    return { status: 'signed-out' }
  }
  if (!raw) return { status: 'signed-out' }
  return detectCodexLoginFromFiles({ 'auth.json': raw })
}
