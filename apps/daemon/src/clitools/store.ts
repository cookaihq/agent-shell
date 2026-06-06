import fs from 'node:fs'; import path from 'node:path'
import { CliToolDef } from '@agent-shell/contracts'

/** 已加入命令行工具清单的持久化（~/.agent-shell/cli-tools.json）。仿 skills/sources.ts 的 makeSourceStore。 */
export interface CliToolStore {
  list: () => CliToolDef[]
  add: (def: CliToolDef) => CliToolDef     // 同 id 幂等（返回既有）
  remove: (id: string) => void
}

export function makeCliToolStore(file: string): CliToolStore {
  const readRaw = (): CliToolDef[] => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { added?: unknown[] }
      return (raw.added ?? []).flatMap((t) => { const r = CliToolDef.safeParse(t); return r.success ? [r.data] : [] })
    } catch { return [] }
  }
  const writeRaw = (added: CliToolDef[]) => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify({ added }, null, 2), { mode: 0o600 })
    try { fs.chmodSync(file, 0o600) } catch { /* 既存文件兜底 */ }
  }
  return {
    list: readRaw,
    add: (def) => {
      const cur = readRaw()
      const existing = cur.find((t) => t.id === def.id)
      if (existing) return existing
      writeRaw([...cur, def]); return def
    },
    remove: (id) => writeRaw(readRaw().filter((t) => t.id !== id)),
  }
}
