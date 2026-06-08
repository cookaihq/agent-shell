import fs from 'node:fs'; import path from 'node:path'
import { SkillSourceDef, type AddSourceReq, type PatchSourceReq } from '@agent-shell/contracts'

export interface SourceStore {
  list: () => SkillSourceDef[]
  add: (req: AddSourceReq) => SkillSourceDef
  patch: (id: string, partial: PatchSourceReq) => SkillSourceDef
  remove: (id: string) => void
  reorder: (order: string[]) => void
  upsert: (def: SkillSourceDef) => void
}

export function makeSourceStore(file: string): SourceStore {
  const readRaw = (): SkillSourceDef[] => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { sources?: unknown[] }
      return (raw.sources ?? []).flatMap((s) => { const r = SkillSourceDef.safeParse(s); return r.success ? [r.data] : [] })
    } catch { return [] }
  }
  const writeRaw = (sources: SkillSourceDef[]) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ sources }, null, 2), { mode: 0o600 })
    try { fs.chmodSync(file, 0o600) } catch { /* */ }   // 既存文件兜底
  }
  const list = () => readRaw().slice().sort((a, b) => a.sortIndex - b.sortIndex)
  const genId = () => 's_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  return {
    list,
    add: (req) => {
      const cur = readRaw()
      const sortIndex = cur.length ? Math.max(...cur.map(s => s.sortIndex)) + 1 : 0
      const def = SkillSourceDef.parse({ ...req, id: genId(), sortIndex })
      writeRaw([...cur, def]); return def
    },
    patch: (id, partial) => {
      const cur = readRaw(); const i = cur.findIndex(s => s.id === id)
      if (i < 0) throw new Error('source not found')
      cur[i] = SkillSourceDef.parse({ ...cur[i], ...partial }); writeRaw(cur); return cur[i]
    },
    remove: (id) => writeRaw(readRaw().filter(s => s.id !== id)),
    reorder: (order) => {
      const cur = readRaw(); const pos = new Map(order.map((id, i) => [id, i]))
      writeRaw(cur.map(s => ({ ...s, sortIndex: pos.get(s.id) ?? s.sortIndex }))) },
    upsert: (def) => {
      const cur = readRaw(); const i = cur.findIndex(s => s.id === def.id)
      if (i >= 0) { cur[i] = SkillSourceDef.parse(def); writeRaw(cur) }
      else { writeRaw([...cur, SkillSourceDef.parse(def)]) }
    },
  }
}
