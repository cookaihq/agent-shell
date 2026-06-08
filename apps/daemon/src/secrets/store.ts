import fs from 'node:fs'
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import type { SecretView, CreateSecretReq, UpdateSecretReq } from '@agent-shell/contracts'

interface StoredSecret { id: string; name: string; value: string; note: string; createdAt: number }
interface FileShape { version: 1; secrets: StoredSecret[] }

function emptyFile(): FileShape { return { version: 1, secrets: [] } }
function maskValue(v: string): string { return !v ? '' : v.length <= 4 ? '…' : '…' + v.slice(-4) }
function toView(s: StoredSecret): SecretView {
  return { id: s.id, name: s.name, note: s.note, hasValue: !!s.value, maskedValue: maskValue(s.value), createdAt: s.createdAt }
}

export interface SecretStore {
  view(): SecretView[]
  getValue(id: string): string | undefined
  create(req: CreateSecretReq): SecretView
  createPlaceholder(name: string, note: string): SecretView
  update(id: string, patch: UpdateSecretReq): SecretView | null
  remove(id: string): void
}

export function makeSecretStore(file: string): SecretStore {
  const read = (): FileShape => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as FileShape
      return raw?.secrets ? { version: 1, secrets: raw.secrets } : emptyFile()
    } catch { return emptyFile() }
  }
  const write = (f: FileShape): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(f, null, 2), { mode: 0o600 })
    try { fs.chmodSync(file, 0o600) } catch { /* 兜底收紧权限 */ }
  }
  return {
    view() { return read().secrets.map(toView) },
    getValue(id) { return read().secrets.find((s) => s.id === id)?.value },
    create(req) {
      const f = read()
      const s: StoredSecret = { id: 'k_' + randomUUID().slice(0, 8), name: req.name, value: req.value, note: req.note ?? '', createdAt: Date.now() }
      f.secrets.push(s); write(f)
      return toView(s)
    },
    createPlaceholder(name, note) {
      const f = read()
      const s: StoredSecret = { id: 'k_' + randomUUID().slice(0, 8), name, value: '', note, createdAt: Date.now() }
      f.secrets.push(s); write(f)
      return toView(s)
    },
    update(id, patch) {
      const f = read(); const s = f.secrets.find((x) => x.id === id); if (!s) return null
      if (patch.name !== undefined) s.name = patch.name
      if (patch.note !== undefined) s.note = patch.note
      if (patch.value) s.value = patch.value   // 空串/省略 = 保留原值
      write(f); return toView(s)
    },
    remove(id) {
      const f = read(); f.secrets = f.secrets.filter((x) => x.id !== id); write(f)
    },
  }
}
