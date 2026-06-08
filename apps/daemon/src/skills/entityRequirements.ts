import fs from 'node:fs'
import path from 'node:path'
import type { EntityRequirement } from '@agent-shell/contracts'

interface FileShape { version: 1; requirements: Record<string, EntityRequirement> }
function emptyFile(): FileShape { return { version: 1, requirements: {} } }

export interface EntityRequirementStore {
  all(): Record<string, EntityRequirement>
  get(ref: string): EntityRequirement | undefined
  put(ref: string, req: EntityRequirement): void
  /** 只更新 needsConfig 快信号，保留已有 slots/slotsSource/bind（静态扫描用，不清用户配置）。 */
  setNeedsConfig(ref: string, needsConfig: boolean): void
  /** secretId → 引用它的 entityRef 列表（供「谁在用」）。 */
  usageBySecret(): Record<string, string[]>
}

export function makeEntityRequirementStore(file: string): EntityRequirementStore {
  const read = (): FileShape => {
    try {
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as FileShape
      return raw?.requirements ? { version: 1, requirements: raw.requirements } : emptyFile()
    } catch { return emptyFile() }
  }
  const write = (f: FileShape): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(file, JSON.stringify(f, null, 2), { mode: 0o600 })
    try { fs.chmodSync(file, 0o600) } catch { /* 兜底 */ }
  }
  return {
    all() { return read().requirements },
    get(ref) { return read().requirements[ref] },
    put(ref, req) { const f = read(); f.requirements[ref] = req; write(f) },
    setNeedsConfig(ref, needsConfig) {
      const f = read()
      const prev = f.requirements[ref]
      f.requirements[ref] = prev
        ? { ...prev, needsConfig }
        : { needsConfig, slotsSource: null }
      write(f)
    },
    usageBySecret() {
      const out: Record<string, string[]> = {}
      const reqs = read().requirements
      for (const ref of Object.keys(reqs)) {
        for (const slot of reqs[ref].slots ?? []) {
          if (slot.bind) (out[slot.bind] ??= []).push(ref)
        }
      }
      return out
    },
  }
}
