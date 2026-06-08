import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { ProxyView } from '@agent-shell/contracts'

/** 代理池条目（含代理凭证明文，落 proxies.json 0600）。
 *  字段对照 sub2api ent/schema/proxy.go：protocol ∈ http | https | socks5 | socks5h。
 *  Task 5.3 才加 renderer 视图/contract，这里只是 daemon 内部类型。 */
export interface StoredProxy {
  id: string
  name: string
  protocol: string
  host: string
  port: number
  username?: string
  password?: string
  /** 占位：后续代理可用性/测速语义（sub2api 默认 'active'）。当前未消费。 */
  status?: string
  createdAt: number
}
interface FileShape { version: 1; proxies: StoredProxy[] }

function emptyFile(): FileShape { return { version: 1, proxies: [] } }

type CreateReq = { name: string; protocol: string; host: string; port: number; username?: string; password?: string; status?: string }
type UpdateReq = Partial<CreateReq>

/** 脱敏：把内部 StoredProxy 转成渲染层视图，绝不带明文 password（只回 hasPassword）。 */
export function toProxyView(p: StoredProxy): ProxyView {
  return {
    id: p.id, name: p.name, protocol: p.protocol as ProxyView['protocol'], host: p.host, port: p.port,
    username: p.username || undefined, hasPassword: !!p.password, status: p.status, createdAt: p.createdAt,
  }
}

export interface ProxyStore {
  list(): StoredProxy[]
  /** 渲染层视图（脱敏）：永不含明文 password。 */
  view(): ProxyView[]
  get(id: string): StoredProxy | undefined
  create(req: CreateReq): StoredProxy
  update(id: string, patch: UpdateReq): StoredProxy | null
  remove(id: string): void
}

export function makeProxyStore(file: string): ProxyStore {
  const read = (): FileShape => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as FileShape
      return raw?.proxies ? { version: 1, proxies: raw.proxies } : emptyFile()
    } catch { return emptyFile() }
  }
  const write = (f: FileShape): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(f, null, 2), { mode: 0o600 })
    try { fs.chmodSync(file, 0o600) } catch { /* 兜底收紧权限 */ }
  }
  return {
    list() { return read().proxies },
    view() { return read().proxies.map(toProxyView) },
    get(id) { return read().proxies.find((p) => p.id === id) },
    create(req) {
      const f = read()
      const p: StoredProxy = {
        id: 'px_' + randomUUID().slice(0, 8),
        name: req.name,
        protocol: req.protocol,
        host: req.host,
        port: req.port,
        username: req.username,
        password: req.password,
        status: req.status,
        createdAt: Date.now(),
      }
      f.proxies.push(p); write(f)
      return p
    },
    update(id, patch) {
      const f = read(); const p = f.proxies.find((x) => x.id === id); if (!p) return null
      // 普通字段：!== undefined 即覆盖（username 可清空为 ''）
      if (patch.name !== undefined) p.name = patch.name
      if (patch.protocol !== undefined) p.protocol = patch.protocol
      if (patch.host !== undefined) p.host = patch.host
      if (patch.port !== undefined) p.port = patch.port
      if (patch.username !== undefined) p.username = patch.username
      if (patch.status !== undefined) p.status = patch.status
      // password 沿用 secrets store 约定：真值才覆盖，空串/省略 = 保留原值（避免编辑时误清密码）
      if (patch.password) p.password = patch.password
      write(f); return p
    },
    remove(id) {
      const f = read(); f.proxies = f.proxies.filter((x) => x.id !== id); write(f)
    },
  }
}
