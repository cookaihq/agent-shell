import fs from 'node:fs'; import path from 'node:path'
import { SkillGroupDef, type AddGroupReq, type PatchGroupReq } from '@agent-shell/contracts'

export interface GroupStore {
  list: () => SkillGroupDef[]
  add: (req: AddGroupReq) => SkillGroupDef
  patch: (id: string, partial: PatchGroupReq) => SkillGroupDef
  remove: (id: string) => void
  reorder: (order: string[]) => void
  upsert: (def: SkillGroupDef) => void
}

export function makeGroupStore(file: string): GroupStore {
  const readRaw = (): SkillGroupDef[] => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { groups?: unknown[] }
      return (raw.groups ?? []).flatMap((g) => { const r = SkillGroupDef.safeParse(g); return r.success ? [r.data] : [] })
    } catch { return [] }
  }
  const writeRaw = (groups: SkillGroupDef[]) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ groups }, null, 2), { mode: 0o600 })
    try { fs.chmodSync(file, 0o600) } catch { /* */ }
  }
  const list = () => readRaw().slice().sort((a, b) => a.sortIndex - b.sortIndex)
  const genId = () => 'g_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
  return {
    list,
    add: (req) => {
      const cur = readRaw()
      const sortIndex = cur.length ? Math.max(...cur.map(g => g.sortIndex)) + 1 : 0
      const def = SkillGroupDef.parse({ ...req, id: genId(), sortIndex })
      writeRaw([...cur, def]); return def
    },
    patch: (id, partial) => {
      const cur = readRaw(); const i = cur.findIndex(g => g.id === id)
      if (i < 0) throw new Error('group not found')
      cur[i] = SkillGroupDef.parse({ ...cur[i], ...partial }); writeRaw(cur); return cur[i]
    },
    remove: (id) => writeRaw(readRaw().filter(g => g.id !== id)),
    reorder: (order) => {
      const cur = readRaw(); const pos = new Map(order.map((id, i) => [id, i]))
      writeRaw(cur.map(g => ({ ...g, sortIndex: pos.get(g.id) ?? g.sortIndex })))
    },
    upsert: (def) => {
      const cur = readRaw(); const i = cur.findIndex(g => g.id === def.id)
      if (i >= 0) { cur[i] = SkillGroupDef.parse(def); writeRaw(cur) }
      else { writeRaw([...cur, SkillGroupDef.parse(def)]) }
    },
  }
}
