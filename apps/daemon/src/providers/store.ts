import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Engine, ProviderView, CreateProviderReq, UpdateProviderReq, ProvidersResp } from '@agent-shell/contracts'
import type { ProviderCreds } from '../runtimes/types'

const ENGINES: Engine[] = ['claude', 'codex']

interface StoredProvider {
  id: string; engine: Engine; name: string; baseUrl: string
  apiKey: string; keyEnv: 'api_key' | 'auth_token'; sortIndex: number; createdAt: number
}
interface FileShape {
  version: 1
  engines: Record<Engine, { active: string; providers: StoredProvider[] }>
}

function emptyFile(): FileShape {
  return { version: 1, engines: { claude: { active: 'default', providers: [] }, codex: { active: 'default', providers: [] } } }
}
function maskKey(k: string): string {
  if (!k) return ''
  // 永不回传完整 key：≤4 字符无法只露尾 4 位 → 全隐；其余仅露尾 4 位
  return k.length <= 4 ? '…' : 'sk-…' + k.slice(-4)
}
function toView(p: StoredProvider): ProviderView {
  return { id: p.id, engine: p.engine, name: p.name, baseUrl: p.baseUrl, keyEnv: p.keyEnv,
    hasKey: !!p.apiKey, maskedKey: maskKey(p.apiKey), sortIndex: p.sortIndex, createdAt: p.createdAt }
}

export interface ProviderStore {
  view(): ProvidersResp
  create(req: CreateProviderReq): ProviderView
  update(id: string, patch: UpdateProviderReq): ProviderView | null
  remove(id: string): void
  setActive(engine: Engine, providerId: string): void
  resolveActiveCreds(engine: Engine): ProviderCreds | undefined
  getStored(id: string): StoredProvider | undefined
}

export function makeProviderStore(file: string): ProviderStore {
  const read = (): FileShape => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as FileShape
      const base = emptyFile()
      for (const e of ENGINES) if (raw.engines?.[e]) base.engines[e] = raw.engines[e]
      return base
    } catch { return emptyFile() }
  }
  const write = (f: FileShape): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(f, null, 2), { mode: 0o600 })
    try { fs.chmodSync(file, 0o600) } catch { /* 已存在文件兜底收紧权限 */ }
  }
  const findEngine = (f: FileShape, id: string): Engine | undefined =>
    ENGINES.find((e) => f.engines[e].providers.some((p) => p.id === id))

  return {
    view() {
      const f = read()
      const out = { engines: {} as ProvidersResp['engines'] }
      for (const e of ENGINES) out.engines[e] = { active: f.engines[e].active, providers: f.engines[e].providers.map(toView) }
      return out
    },
    create(req) {
      const f = read()
      const list = f.engines[req.engine].providers
      const p: StoredProvider = { id: 'p_' + randomUUID().slice(0, 8), engine: req.engine, name: req.name,
        baseUrl: req.baseUrl, apiKey: req.apiKey, keyEnv: req.keyEnv ?? 'api_key', sortIndex: list.length, createdAt: Date.now() }
      list.push(p); write(f)
      return toView(p)
    },
    update(id, patch) {
      const f = read(); const e = findEngine(f, id); if (!e) return null
      const p = f.engines[e].providers.find((x) => x.id === id)!
      if (patch.name !== undefined) p.name = patch.name
      if (patch.baseUrl !== undefined) p.baseUrl = patch.baseUrl
      if (patch.keyEnv !== undefined) p.keyEnv = patch.keyEnv
      if (patch.apiKey) p.apiKey = patch.apiKey   // 空串/省略 = 保留原 key
      write(f)
      return toView(p)
    },
    remove(id) {
      const f = read(); const e = findEngine(f, id); if (!e) return
      f.engines[e].providers = f.engines[e].providers.filter((x) => x.id !== id)
      if (f.engines[e].active === id) f.engines[e].active = 'default'
      write(f)
    },
    setActive(engine, providerId) {
      const f = read()
      // 仅允许切到内置 'default' 或该引擎下确实存在的 provider；非法 id 静默 no-op，绝不写入幽灵 active
      if (providerId !== 'default' && !f.engines[engine].providers.some((p) => p.id === providerId)) return
      f.engines[engine].active = providerId; write(f)
    },
    resolveActiveCreds(engine) {
      const f = read(); const active = f.engines[engine].active
      if (active === 'default') return undefined
      const p = f.engines[engine].providers.find((x) => x.id === active)
      if (!p) return undefined
      return { baseUrl: p.baseUrl, apiKey: p.apiKey, keyEnv: p.keyEnv }
    },
    getStored(id) {
      const f = read()
      for (const e of ENGINES) { const p = f.engines[e].providers.find((x) => x.id === id); if (p) return p }
      return undefined
    },
  }
}
