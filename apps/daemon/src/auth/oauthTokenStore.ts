import fs from 'node:fs'
import path from 'node:path'
import type { Engine } from '@agent-shell/contracts'
import type { AuthSourceState, OAuthTokenRecord } from './sourceStore'

export type { OAuthTokenRecord }

const ENGINES: Engine[] = ['claude', 'codex']

// 与 sourceStore 共写同一个 auth.json：engines 下每引擎子对象除 activeSource/officialKeySecretId
// 外，再挂一个 oauth 子字段。两个 store 各管自己的字段，靠各自 read() 的浅合并互不覆盖。
interface FileShape { version: 1; engines: Record<Engine, AuthSourceState> }

function defaultState(): AuthSourceState { return { activeSource: 'cli-login' } }
function emptyFile(): FileShape {
  return { version: 1, engines: { claude: defaultState(), codex: defaultState() } }
}

export interface OAuthTokenStore {
  get(engine: Engine): OAuthTokenRecord | undefined
  set(engine: Engine, rec: OAuthTokenRecord): void
  clear(engine: Engine): void
}

export function makeOAuthTokenStore(file: string): OAuthTokenStore {
  const read = (): FileShape => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as FileShape
      const base = emptyFile()
      // 浅合并而非整体替换：auth.json 由 sourceStore + oauthTokenStore 共写，写回 oauth 时必须
      // 保留对端写入的 activeSource/officialKeySecretId，绝不 clobber。
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
    get(engine) { return read().engines[engine].oauth },
    set(engine, rec) {
      const f = read(); f.engines[engine].oauth = rec; write(f)
    },
    clear(engine) {
      const f = read(); delete f.engines[engine].oauth; write(f)
    },
  }
}
