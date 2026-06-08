import fs from 'node:fs'; import path from 'node:path'
import { createHash } from 'node:crypto'
import { libraryManifestPath } from '../paths'
import { parseSkillFrontmatter } from './frontmatter'

export interface ManifestEntry { sourceId: string; name: string; relPath: string; autoInject?: boolean; fingerprint?: string }
export type Manifest = Record<string, ManifestEntry>   // key = effectiveName（库内目录名）

export interface Library {
  manifest: () => Manifest
  isIn: (sourceId: string, relPath: string) => boolean
  effNameOf: (sourceId: string, relPath: string) => string | undefined
  add: (a: { sourceId: string; name: string; srcSkillDir: string; relPath: string }) => string  // 返回 effectiveName
  remove: (sourceId: string, relPath: string) => void
  setAutoInject: (effectiveName: string, on: boolean) => void
}

export function makeLibrary(skillsDir: string): Library {
  const file = libraryManifestPath(skillsDir)
  const read = (): Manifest => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest } catch { return {} } }
  const write = (m: Manifest) => { fs.mkdirSync(skillsDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(m, null, 2)) }
  const findEff = (m: Manifest, sourceId: string, relPath: string) =>
    Object.keys(m).find(eff => m[eff].sourceId === sourceId && m[eff].relPath === relPath)
  const fingerprintOf = (skillDir: string): string => {
    try { return createHash('sha256').update(fs.readFileSync(path.join(skillDir, 'SKILL.md'))).digest('hex') } catch { return '' }
  }
  const seedAutoInject = (skillDir: string): boolean => {
    try { return parseSkillFrontmatter(fs.readFileSync(path.join(skillDir, 'SKILL.md'), 'utf8')).autoInject === true } catch { return false }
  }
  return {
    manifest: read,
    isIn: (sourceId, relPath) => !!findEff(read(), sourceId, relPath),
    effNameOf: (sourceId, relPath) => findEff(read(), sourceId, relPath),
    add: ({ sourceId, name, srcSkillDir, relPath }) => {
      const m = read()
      const existing = findEff(m, sourceId, relPath)
      if (existing) return existing                                  // 幂等
      // 重名消歧：name 已被别的源占用 → name__<sourceId>
      let eff = name
      if (m[eff] && m[eff].sourceId !== sourceId) eff = `${name}__${sourceId}`
      const dest = path.join(skillsDir, eff)
      // 自指守卫：folder 源本身就在 skillsDir/<eff> 时，rm+cp 会删掉源；已就位，只记 manifest
      if (path.resolve(srcSkillDir) === path.resolve(dest)) { m[eff] = { sourceId, name, relPath, autoInject: seedAutoInject(srcSkillDir), fingerprint: fingerprintOf(srcSkillDir) }; write(m); return eff }
      fs.rmSync(dest, { recursive: true, force: true })
      fs.mkdirSync(skillsDir, { recursive: true })
      fs.cpSync(srcSkillDir, dest, { recursive: true, dereference: true })
      m[eff] = { sourceId, name, relPath, autoInject: seedAutoInject(srcSkillDir), fingerprint: fingerprintOf(srcSkillDir) }; write(m)
      return eff
    },
    remove: (sourceId, relPath) => {
      const m = read(); const eff = findEff(m, sourceId, relPath); if (!eff) return
      fs.rmSync(path.join(skillsDir, eff), { recursive: true, force: true })
      delete m[eff]; write(m)
    },
    setAutoInject: (effectiveName, on) => { const m = read(); if (m[effectiveName]) { m[effectiveName].autoInject = on; write(m) } },
  }
}
