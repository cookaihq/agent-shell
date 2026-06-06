import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { SkillSourceDef, ProbedSkill, LibrarySkill, AddSourceReq } from '@agent-shell/contracts'
import { makeSourceStore, type SourceStore } from './sources'
import { probeSkills } from './probe'
import { cloneOrPull } from './clone'
import { makeLibrary, type Library } from './library'
import { detectGlobalEngines } from './global'
import { parseSkillFrontmatter } from './frontmatter'
import { SkillError } from './store'
import { skillSourcesPath, skillSrcCacheDir } from '../paths'

export interface SkillService {
  listSources: () => SkillSourceDef[]
  addSource: (req: AddSourceReq) => SkillSourceDef     // git 源会 clone（market 跳过）
  patchSource: SourceStore['patch']
  removeSource: (id: string) => void                    // 同时移出该源的所有在库技能 + 清缓存
  reorderSources: SourceStore['reorder']
  reprobe: (id: string) => ProbedSkill[]                // git 源先 pull，再 probe
  probe: (id: string) => ProbedSkill[]                  // 不拉取，直接 probe（folder loc / git 缓存）
  toggleLib: (sourceId: string, relPath: string, inLib: boolean) => void
  readSkillMd: (sourceId: string, relPath: string) => string   // 读探测到技能的 SKILL.md 原文（预览用）
  setUpdateMode: (id: string, mode: SkillSourceDef['updateMode']) => SkillSourceDef  // autolib 时整源入库
  listLibrary: () => LibrarySkill[]
}

/** sourcesFile / cacheRoot 可注入（测试隔离，缺省用 paths.ts 真实路径，对齐 transcriptDir/skillsDir 注入惯例）。 */
export function makeSkillService(
  getSkillsDir: () => string,
  sourcesFile: string = skillSourcesPath(),
  cacheRoot: string = skillSrcCacheDir(),
  home: string = os.homedir(),
): SkillService {
  const store = makeSourceStore(sourcesFile)
  const lib = (): Library => makeLibrary(getSkillsDir())

  /** 源工作树目录：folder 用 loc；git 用缓存。 */
  const workTree = (s: SkillSourceDef): string =>
    s.type === 'folder' ? s.loc : path.join(cacheRoot, s.id)

  const probedFor = (s: SkillSourceDef): ProbedSkill[] => {
    if (s.type === 'market') return []
    const L = lib()
    return probeSkills(workTree(s)).map((p) => {
      const eff = L.effNameOf(s.id, p.relPath)
      return {
        sourceId: s.id, name: p.name, relPath: p.relPath, desc: p.desc,
        inLib: L.isIn(s.id, p.relPath),
        effectiveName: eff,
        globalIn: detectGlobalEngines(eff ?? p.name, home),   // 覆盖预警按注入名（effectiveName），未入库回落 raw name
      }
    })
  }
  const find = (id: string): SkillSourceDef => {
    const s = store.list().find((x) => x.id === id)
    if (!s) throw new SkillError('not_found', '技能源不存在')
    return s
  }
  const materializeAll = (s: SkillSourceDef) => {
    const L = lib(); const wt = workTree(s)
    for (const p of probeSkills(wt)) L.add({ sourceId: s.id, name: p.name, srcSkillDir: path.join(wt, p.relPath), relPath: p.relPath })
  }

  return {
    listSources: store.list,
    addSource: (req) => {
      const s = store.add(req)
      if (s.type === 'git') { try { cloneOrPull(s, cacheRoot) } catch (e) { store.remove(s.id); throw e } }  // clone 失败回滚，不留幽灵源
      return s
    },
    patchSource: (id, partial) => { find(id); return store.patch(id, partial) },   // find 抛 SkillError('not_found')→404
    removeSource: (id) => {
      const s = find(id); const L = lib(); const m = L.manifest()
      for (const eff of Object.keys(m)) if (m[eff].sourceId === id) L.remove(id, m[eff].relPath)
      store.remove(id)
      try { fs.rmSync(path.join(cacheRoot, s.id), { recursive: true, force: true }) } catch { /* */ }
    },
    reorderSources: store.reorder,
    probe: (id) => probedFor(find(id)),
    reprobe: (id) => { const s = find(id); if (s.type === 'git') cloneOrPull(s, cacheRoot); return probedFor(s) },
    toggleLib: (sourceId, relPath, inLib) => {
      const s = find(sourceId); const L = lib()
      if (inLib) {
        const wt = workTree(s); const p = probeSkills(wt).find((x) => x.relPath === relPath)
        if (!p) throw new SkillError('not_found', '技能不存在')
        L.add({ sourceId, name: p.name, srcSkillDir: path.join(wt, relPath), relPath })
      } else { L.remove(sourceId, relPath) }
    },
    readSkillMd: (sourceId, relPath) => {
      const s = find(sourceId); const wt = workTree(s)
      const abs = path.resolve(wt, relPath, 'SKILL.md')
      if (!abs.startsWith(path.resolve(wt) + path.sep)) throw new SkillError('not_found', '技能路径越界')   // 防穿越
      try { return fs.readFileSync(abs, 'utf8') } catch { throw new SkillError('not_found', 'SKILL.md 不存在') }
    },
    setUpdateMode: (id, mode) => { find(id); const s = store.patch(id, { updateMode: mode }); if (mode === 'autolib') materializeAll(s); return s },
    listLibrary: () => {
      const skillsDir = getSkillsDir(); const m = lib().manifest(); const sources = store.list()
      return Object.keys(m).map((eff) => {
        const e = m[eff]; const src = sources.find((s) => s.id === e.sourceId)
        let desc = ''
        try { desc = parseSkillFrontmatter(fs.readFileSync(path.join(skillsDir, eff, 'SKILL.md'), 'utf8')).description ?? '' } catch { /* */ }
        return { effectiveName: eff, name: e.name, desc, sourceId: e.sourceId, sourceName: src?.name ?? e.sourceId, globalIn: detectGlobalEngines(eff, home) }
      })
    },
  }
}
