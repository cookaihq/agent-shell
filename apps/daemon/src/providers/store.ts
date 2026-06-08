import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { z, type Engine, type ProviderView, CreateProviderReq, type UpdateProviderReq, type ProvidersResp, type ProviderModel } from '@agent-shell/contracts'
import type { ProviderCreds } from '../runtimes/types'
import type { SecretStore } from '../secrets/store'
import type { AuthSourceStore } from '../auth/sourceStore'
import type { OAuthTokenStore } from '../auth/oauthTokenStore'

const ENGINES: Engine[] = ['claude', 'codex']

interface StoredProvider {
  id: string; engine: Engine; name: string; baseUrl: string
  apiKey: string; apiKeySecretId?: string; keyEnv: 'api_key' | 'auth_token'; sortIndex: number; createdAt: number
  models?: ProviderModel[]; defaultModel?: string; wireApi?: 'chat' | 'responses'
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
    hasKey: !!p.apiKey, maskedKey: maskKey(p.apiKey), apiKeySecretId: p.apiKeySecretId,
    sortIndex: p.sortIndex, createdAt: p.createdAt,
    models: p.models ?? [], defaultModel: p.defaultModel, wireApi: p.wireApi ?? 'responses' }
}

export interface ProviderStore {
  view(): ProvidersResp
  create(req: z.input<typeof CreateProviderReq>): ProviderView
  update(id: string, patch: UpdateProviderReq): ProviderView | null
  remove(id: string): void
  setActive(engine: Engine, providerId: string): void
  resolveActiveCreds(engine: Engine): ProviderCreds | undefined
  getStored(id: string): StoredProvider | undefined
  /** secretId → 引用它的 Provider 名称列表（供「谁在用」）。 */
  usageBySecret(): Record<string, string[]>
}

export function makeProviderStore(file: string, secrets: Pick<SecretStore, 'getValue'>, sourceStore: AuthSourceStore, oauthTokens: Pick<OAuthTokenStore, 'get'>): ProviderStore {
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
    create(req: z.input<typeof CreateProviderReq>) {
      const f = read()
      const list = f.engines[req.engine].providers
      const p: StoredProvider = { id: 'p_' + randomUUID().slice(0, 8), engine: req.engine, name: req.name,
        baseUrl: req.baseUrl, apiKey: req.apiKey ?? '', apiKeySecretId: req.apiKeySecretId, keyEnv: req.keyEnv ?? 'api_key', sortIndex: list.length, createdAt: Date.now(),
        models: req.models ?? [], defaultModel: req.defaultModel, wireApi: req.wireApi ?? 'responses' }
      list.push(p); write(f)
      return toView(p)
    },
    update(id, patch) {
      const f = read(); const e = findEngine(f, id); if (!e) return null
      const p = f.engines[e].providers.find((x) => x.id === id)!
      if (patch.name !== undefined) p.name = patch.name
      if (patch.baseUrl !== undefined) p.baseUrl = patch.baseUrl
      if (patch.keyEnv !== undefined) p.keyEnv = patch.keyEnv
      if (patch.models !== undefined) p.models = patch.models
      if (patch.defaultModel !== undefined) p.defaultModel = patch.defaultModel
      if (patch.wireApi !== undefined) p.wireApi = patch.wireApi
      if (patch.apiKeySecretId !== undefined) p.apiKeySecretId = patch.apiKeySecretId
      if (patch.apiKey) p.apiKey = patch.apiKey   // 空串/省略 = 保留原 key
      write(f)
      return toView(p)
    },
    remove(id) {
      const f = read(); const e = findEngine(f, id); if (!e) return
      f.engines[e].providers = f.engines[e].providers.filter((x) => x.id !== id)
      if (f.engines[e].active === id) f.engines[e].active = 'default'
      write(f)
      // 删的若正是当前来源权威指向的 provider，同步把 sourceStore 回落 cli-login（镜像 setActive 的 default→cli-login），
      // 避免 sourceStore 残留死 providerId 与 view().active='default' 失谐；只在确为该来源时重置，勿误伤 official-key/oauth
      if (sourceStore.get(e).activeSource === id) sourceStore.setSource(e, 'cli-login')
    },
    setActive(engine, providerId) {
      const f = read()
      // 仅允许切到内置 'default' 或该引擎下确实存在的 provider；非法 id 静默 no-op，绝不写入幽灵 active
      if (providerId !== 'default' && !f.engines[engine].providers.some((p) => p.id === providerId)) return
      f.engines[engine].active = providerId; write(f)   // 保留 providers.json active 写入（view() 仍读它）
      // 凭证来源以 sourceStore 为唯一权威：default → cli-login（用引擎自身登录），否则 providerId 作为来源
      sourceStore.setSource(engine, providerId === 'default' ? 'cli-login' : providerId)
    },
    resolveActiveCreds(engine) {
      // 凭证来源唯一权威 = sourceStore.activeSource
      const { activeSource, officialKeySecretId } = sourceStore.get(engine)
      if (activeSource === 'cli-login') return undefined   // 不注入，claude 用 ~/.claude 自身登录态
      if (activeSource === 'oauth') {
        // app 内 OAuth：access_token 走官方端点（不覆盖 base_url），keyEnv=auth_token → env.ts 注入为 ANTHROPIC_AUTH_TOKEN
        const tok = oauthTokens.get(engine)
        if (!tok?.accessToken) return undefined
        return { baseUrl: undefined, apiKey: tok.accessToken, keyEnv: 'auth_token' }
      }
      if (activeSource === 'official-key') {
        // 官网 key：x-api-key 风格走官方端点，绝不覆盖 base_url
        if (!officialKeySecretId) return undefined
        const apiKey = secrets.getValue(officialKeySecretId)
        if (!apiKey) return undefined
        return { baseUrl: undefined, apiKey, keyEnv: 'api_key' }
      }
      // 其余 = providerId 字符串（自定义 provider 作为来源）
      const f = read()
      const p = f.engines[engine].providers.find((x) => x.id === activeSource)
      if (!p) return undefined
      // 引用密钥库时经 SecretStore 解析真实值（密钥不存在 → 空串，不回落裸值）；否则用裸 apiKey
      const apiKey = p.apiKeySecretId ? (secrets.getValue(p.apiKeySecretId) ?? '') : p.apiKey
      // codex 的 Provider 注入更富（需 provider 名 + wire_api），走 app-server `-c` 启动覆盖（见 codexAppServer.buildCodexProviderArgs）：
      // base_url 由 `-c` 承载 → 顶层 baseUrl 留空（避免 env.ts 再写 OPENAI_BASE_URL 双重配置）；name/wireApi 进 codex 扩展。
      // claude 仍走纯 env：baseUrl 顶层返回 → env.ts 写 baseUrlEnv（路径不变）。
      if (engine === 'codex') {
        return { baseUrl: undefined, apiKey, keyEnv: p.keyEnv, codex: { providerName: p.name, baseUrl: p.baseUrl, wireApi: p.wireApi ?? 'responses' } }
      }
      return { baseUrl: p.baseUrl, apiKey, keyEnv: p.keyEnv }
    },
    getStored(id) {
      const f = read()
      for (const e of ENGINES) { const p = f.engines[e].providers.find((x) => x.id === id); if (p) return p }
      return undefined
    },
    usageBySecret() {
      const out: Record<string, string[]> = {}
      const f = read()
      for (const e of ENGINES) {
        for (const p of f.engines[e].providers) {
          if (p.apiKeySecretId) (out[p.apiKeySecretId] ??= []).push(p.name)
        }
      }
      return out
    },
  }
}
