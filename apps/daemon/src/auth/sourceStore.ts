import fs from 'node:fs'
import path from 'node:path'
import type { Engine } from '@agent-shell/contracts'

const ENGINES: Engine[] = ['claude', 'codex']

/** 凭证来源：内置三种 + 任意 providerId 字符串（自定义 provider 作为来源）。 */
export type AuthSource = 'cli-login' | 'oauth' | 'official-key' | string

/** app 内 OAuth 令牌持久化记录（由 oauthTokenStore 写入，共享 auth.json）。字段与 claudeOAuth 的 OAuthTokens 一致。 */
export interface OAuthTokenRecord { accessToken: string; refreshToken?: string; expiresAt: number; email?: string }

/** 单引擎的凭证来源状态：当前激活来源 + 官网 key 用的密钥库引用。 */
export interface AuthSourceState {
  activeSource: AuthSource
  /** activeSource 为 'official-key' 时使用的密钥库 secretId 引用。 */
  officialKeySecretId?: string
  /** activeSource='oauth' 时的 app 内 OAuth 令牌（由 oauthTokenStore 写入，共享 auth.json）。 */
  oauth?: OAuthTokenRecord
  /** 每来源绑定的代理 id（source 字符串 → proxyId）。cli-login 永不绑代理，不入此表。 */
  proxyBindings?: Record<string, string>
}

// 文件结构：engines 下挂每引擎状态。后续 Phase 4 的 oauthTokenStore 会共享同一文件，
// 在各引擎子对象下新增 oauth 子字段——故保持 engines map 可扩展，勿写死。
interface FileShape { version: 1; engines: Record<Engine, AuthSourceState> }

function defaultState(): AuthSourceState { return { activeSource: 'cli-login' } }
function emptyFile(): FileShape {
  return { version: 1, engines: { claude: defaultState(), codex: defaultState() } }
}

export interface AuthSourceStore {
  get(engine: Engine): AuthSourceState
  setSource(engine: Engine, source: AuthSource): void
  setOfficialKey(engine: Engine, secretId: string): void
  /** 写某引擎下某来源绑定的代理 id；proxyId 空串 → 删除该绑定（=直连）。 */
  setProxy(engine: Engine, source: string, proxyId: string): void
}

export function makeAuthSourceStore(file: string): AuthSourceStore {
  const read = (): FileShape => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as FileShape
      const base = emptyFile()
      // 浅合并而非整体替换：auth.json 由 sourceStore + Phase4 oauthTokenStore 共写，若对端先写入只含 oauth 的引擎对象，这里要用默认值补回缺失的 activeSource
      for (const e of ENGINES) if (raw.engines?.[e]) base.engines[e] = { ...base.engines[e], ...raw.engines[e] }
      return base
    } catch { return emptyFile() }
  }
  const write = (f: FileShape): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(f, null, 2), { mode: 0o600 })
    try { fs.chmodSync(file, 0o600) } catch { /* 已存在文件兜底收紧权限 */ }
  }
  return {
    get(engine) { return read().engines[engine] },
    setSource(engine, source) {
      const f = read(); f.engines[engine].activeSource = source; write(f)
    },
    setOfficialKey(engine, secretId) {
      const f = read(); f.engines[engine].officialKeySecretId = secretId; write(f)
    },
    setProxy(engine, source, proxyId) {
      const f = read()
      const b = f.engines[engine].proxyBindings ??= {}
      if (proxyId) b[source] = proxyId
      else delete b[source]
      write(f)
    },
  }
}
