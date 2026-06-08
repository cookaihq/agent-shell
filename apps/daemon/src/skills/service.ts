import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import type { SkillSourceDef, ProbedSkill, LibrarySkill, AddSourceReq, InstallSkillReq, InstallSkillResult, CreateSkillReq, CreateSkillResult, SkillGroupDef, AddGroupReq, PatchGroupReq } from '@agent-shell/contracts'
import { makeSourceStore, type SourceStore } from './sources'
import { makeGroupStore } from './groups'
import { probeSkills } from './probe'
import { cloneOrPull } from './clone'
import { makeLibrary, type Library } from './library'
import { detectGlobalEngines } from './global'
import { parseSkillFrontmatter } from './frontmatter'
import { SkillError } from './store'
import { skillSourcesPath, skillSrcCacheDir, createdSkillsDir as defaultCreatedDir } from '../paths'
import { scanNeedsConfig } from './scanNeedsConfig'
import type { EntityRequirementStore } from './entityRequirements'
import { agentProbeSlots } from './probeAgent'
import type { ProviderCreds } from '../runtimes/types'
import type { ReqSlot } from '@agent-shell/contracts'

export interface SkillService {
  listSources: () => SkillSourceDef[]
  listGroups: () => SkillGroupDef[]
  addGroup: (req: AddGroupReq) => SkillGroupDef
  patchGroup: (id: string, partial: PatchGroupReq) => SkillGroupDef
  removeGroup: (id: string) => void
  reorderGroups: (order: string[]) => void
  addSource: (req: AddSourceReq) => SkillSourceDef     // git 源会 clone（market 跳过）
  patchSource: SourceStore['patch']
  removeSource: (id: string) => void                    // 同时移出该源的所有在库技能 + 清缓存
  reorderSources: SourceStore['reorder']
  reprobe: (id: string) => ProbedSkill[]                // git 源先 pull，再 probe
  probe: (id: string) => ProbedSkill[]                  // 不拉取，直接 probe（folder loc / git 缓存）
  toggleLib: (sourceId: string, relPath: string, inLib: boolean) => void
  readSkillMd: (sourceId: string, relPath: string) => string   // 读探测到技能的 SKILL.md 原文（预览用）
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  agentProbe: (sourceId: string, relPath: string, creds?: ProviderCreds, queryFn?: (args?: any) => AsyncIterable<unknown>) => Promise<ReqSlot[]>  // 一次性 Agent 精确探测（提议 slots，不落盘）
  setUpdateMode: (id: string, mode: SkillSourceDef['updateMode']) => SkillSourceDef  // autolib 时整源入库
  listLibrary: () => LibrarySkill[]
  setAutoInject: (effectiveName: string, on: boolean) => void
  ensureBuiltinSource: (builtinDir: string) => void
  installSkill: (req: InstallSkillReq) => Promise<InstallSkillResult>
  ensureCreatedSource: () => void
  createSkill: (req: CreateSkillReq) => CreateSkillResult
}

/** sourcesFile / cacheRoot 可注入（测试隔离，缺省用 paths.ts 真实路径，对齐 transcriptDir/skillsDir 注入惯例）。 */
export function makeSkillService(
  getSkillsDir: () => string,
  sourcesFile: string = skillSourcesPath(),
  cacheRoot: string = skillSrcCacheDir(),
  home: string = os.homedir(),
  entityReqs?: EntityRequirementStore,
  createdDir: string = defaultCreatedDir(),
  groupsFile: string = path.join(path.dirname(sourcesFile), 'skill-groups.json'),
): SkillService {
  const store = makeSourceStore(sourcesFile)
  const groupStore = makeGroupStore(groupsFile)
  const lib = (): Library => makeLibrary(getSkillsDir())

  /** 源工作树目录：folder/builtin 用 loc；git 用缓存。 */
  const workTree = (s: SkillSourceDef): string =>
    s.type === 'folder' || s.type === 'builtin' ? s.loc : path.join(cacheRoot, s.id)

  const probedFor = (s: SkillSourceDef): ProbedSkill[] => {
    if (s.type === 'market') return []
    const L = lib()
    const wt = workTree(s)
    return probeSkills(wt).map((p) => {
      const eff = L.effNameOf(s.id, p.relPath)
      return {
        sourceId: s.id, name: p.name, relPath: p.relPath, desc: p.desc,
        inLib: L.isIn(s.id, p.relPath),
        effectiveName: eff,
        globalIn: detectGlobalEngines(eff ?? p.name, home),   // 覆盖预警按注入名（effectiveName），未入库回落 raw name
        needsConfig: scanNeedsConfig(path.join(wt, p.relPath)),
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

  /** 读时幂等迁移：旧用户源无 groupId → 包成单成员分组（名沿用）；系统单例由 ensure* 处理。用 raw store/groupStore 避免递归。 */
  const migrate = () => {
    for (const s of store.list()) {
      if (s.groupId) continue                                    // 已迁移→跳过（幂等）
      if (s.type === 'builtin' || s.id === 'created') continue    // 系统单例由 ensure* 处理
      const g = groupStore.add({ name: s.name })                 // 旧用户源→单成员分组（名沿用）
      store.patch(s.id, { groupId: g.id })
    }
  }

  const removeSourceImpl = (id: string) => {
    const s = find(id)
    if (s.type === 'builtin') throw new SkillError('forbidden', '内置源不可删除')
    const L = lib(); const m = L.manifest()
    for (const eff of Object.keys(m)) if (m[eff].sourceId === id) L.remove(id, m[eff].relPath)
    store.remove(id)
    try { fs.rmSync(path.join(cacheRoot, s.id), { recursive: true, force: true }) } catch { /* */ }
  }

  return {
    listSources: () => { migrate(); return store.list() },
    listGroups: () => { migrate(); return groupStore.list() },
    addGroup: (req) => groupStore.add(req),
    patchGroup: (id, partial) => {
      if (id === 'builtin' || id === 'created') throw new SkillError('forbidden', '系统分组不可编辑')
      return groupStore.patch(id, partial)
    },
    removeGroup: (id) => {
      if (id === 'builtin' || id === 'created') throw new SkillError('forbidden', '系统分组不可删除')
      for (const s of store.list().filter(x => x.groupId === id)) removeSourceImpl(s.id)
      groupStore.remove(id)
    },
    reorderGroups: (order) => groupStore.reorder(order),
    addSource: (req) => {
      if (req.groupId === 'builtin' || req.groupId === 'created') throw new SkillError('forbidden', '系统分组不可添加成员')
      if (req.groupId && !groupStore.list().some(g => g.id === req.groupId)) throw new SkillError('not_found', '目标分组不存在')
      const s = store.add(req)
      if (s.type === 'git') { try { cloneOrPull(s, cacheRoot) } catch (e) { store.remove(s.id); throw e } }  // clone 失败回滚，不留幽灵源
      return s
    },
    patchSource: (id, partial) => { find(id); return store.patch(id, partial) },   // find 抛 SkillError('not_found')→404
    removeSource: removeSourceImpl,
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
    agentProbe: async (sourceId, relPath, creds, queryFn) => {
      const s = find(sourceId); const wt = workTree(s)
      const abs = path.resolve(wt, relPath); const root = path.resolve(wt)
      if (abs !== root && !abs.startsWith(root + path.sep)) throw new SkillError('not_found', '技能路径越界')   // 防穿越（relPath='' 即源根，合法）
      return agentProbeSlots({ skillDir: abs, creds, queryFn })
    },
    setUpdateMode: (id, mode) => { find(id); const s = store.patch(id, { updateMode: mode }); if (mode === 'autolib') materializeAll(s); return s },
    listLibrary: () => {
      const skillsDir = getSkillsDir(); const m = lib().manifest(); const sources = store.list()
      return Object.keys(m).map((eff) => {
        const e = m[eff]; const src = sources.find((s) => s.id === e.sourceId)
        let desc = ''
        try { desc = parseSkillFrontmatter(fs.readFileSync(path.join(skillsDir, eff, 'SKILL.md'), 'utf8')).description ?? '' } catch { /* */ }
        const needsConfig = scanNeedsConfig(path.join(skillsDir, eff))
        entityReqs?.setNeedsConfig('skill:' + eff, needsConfig)
        return { effectiveName: eff, name: e.name, desc, sourceId: e.sourceId, sourceName: src?.name ?? e.sourceId, globalIn: detectGlobalEngines(eff, home), needsConfig, autoInject: e.autoInject === true }
      })
    },
    setAutoInject: (eff, on) => lib().setAutoInject(eff, on),
    ensureBuiltinSource: (builtinDir) => {
      groupStore.upsert({ id: 'builtin', name: '内置', sortIndex: -1 })
      store.upsert({ id: 'builtin', type: 'builtin', name: '内置', loc: builtinDir, groupId: 'builtin', updateMode: 'autolib', sortIndex: -1 })
      const L = lib(); const m0 = L.manifest()
      for (const p of probeSkills(builtinDir)) {
        const eff = L.effNameOf('builtin', p.relPath)
        const prevAuto = eff ? m0[eff]?.autoInject : undefined            // 用户当前开关（可能已改）
        if (eff) L.remove('builtin', p.relPath)                            // 强制重拷（library.add 幂等会跳过）
        const newEff = L.add({ sourceId: 'builtin', name: p.name, srcSkillDir: path.join(builtinDir, p.relPath), relPath: p.relPath })
        if (prevAuto !== undefined) L.setAutoInject(newEff, prevAuto)      // 恢复用户开关，不被种子覆盖
      }
    },
    ensureCreatedSource: () => {
      fs.mkdirSync(createdDir, { recursive: true })
      groupStore.upsert({ id: 'created', name: '自建', sortIndex: -2 })
      store.upsert({ id: 'created', type: 'folder', name: '我创建的', loc: createdDir, groupId: 'created', updateMode: 'manual', sortIndex: -2 })
    },
    createSkill: (req) => {
      const L = lib(); const m = L.manifest()
      const clash = Object.keys(m).find((eff) => eff === req.name || m[eff].name === req.name)
      if (clash) return { status: 'conflict', name: req.name, existingEffectiveName: clash }
      const dir = path.join(createdDir, req.name)
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(path.join(dir, 'SKILL.md'), `---\nname: ${req.name}\ndescription: ${req.description}\n---\n\n${req.body}\n`)
      groupStore.upsert({ id: 'created', name: '自建', sortIndex: -2 })
      store.upsert({ id: 'created', type: 'folder', name: '我创建的', loc: createdDir, groupId: 'created', updateMode: 'manual', sortIndex: -2 })
      const eff = L.add({ sourceId: 'created', name: req.name, srcSkillDir: dir, relPath: req.name + '/' })
      return { status: 'created', name: req.name, effectiveName: eff }
    },
    installSkill: async (req) => {
      // 注册源（与 addSource 逻辑等价；git 源 clone 失败会自动回滚）
      const addReq: AddSourceReq = { type: req.type, name: req.name ?? path.basename(req.loc), loc: req.loc, updateMode: 'manual', ...(req.branch ? { branch: req.branch } : {}) }
      const src = (() => {
        const s = store.add(addReq)
        if (s.type === 'git') { try { cloneOrPull(s, cacheRoot) } catch (e) { store.remove(s.id); throw e } }
        return s
      })()

      const fpOf = (skillDir: string): string => {
        try { return createHash('sha256').update(fs.readFileSync(path.join(skillDir, 'SKILL.md'))).digest('hex') } catch { return '' }
      }

      const installed: InstallSkillResult['installed'] = []
      const already: InstallSkillResult['already'] = []
      const conflicts: InstallSkillResult['conflicts'] = []

      try {
        const wt = workTree(src)
        const L = lib()

        for (const p of probeSkills(wt)) {
          const srcSkillDir = path.join(wt, p.relPath)
          const fp = fpOf(srcSkillDir)
          const m = L.manifest()
          // 找库中所有同名条目（不同 effectiveName 但 name 相同）
          const sameName = Object.keys(m).filter((eff) => m[eff].name === p.name)
          // 看同名条目中有没有指纹一致的（already）
          const matched = sameName.find((eff) => {
            const entryFp = m[eff].fingerprint ?? fpOf(path.join(workTree(find(m[eff].sourceId)), m[eff].relPath))
            return entryFp === fp
          })

          if (matched) {
            already.push({ name: p.name, effectiveName: matched })
          } else if (sameName.length > 0) {
            conflicts.push({ name: p.name, existingEffectiveName: sameName[0] })
          } else {
            const eff = L.add({ sourceId: src.id, name: p.name, srcSkillDir, relPath: p.relPath })
            installed.push({ name: p.name, effectiveName: eff, sourceId: src.id })
          }
        }
      } catch (e) {
        // 出错：回滚源（移除该源的所有已入库技能 + 从 store 删除）
        const L = lib(); const m = L.manifest()
        for (const eff of Object.keys(m)) if (m[eff].sourceId === src.id) L.remove(src.id, m[eff].relPath)
        store.remove(src.id)
        try { fs.rmSync(path.join(cacheRoot, src.id), { recursive: true, force: true }) } catch { /* */ }
        throw e
      }

      // 无任何技能入库（全部 already/conflicts）→ 回滚孤儿源
      if (installed.length === 0) {
        const L = lib(); const m = L.manifest()
        for (const eff of Object.keys(m)) if (m[eff].sourceId === src.id) L.remove(src.id, m[eff].relPath)
        store.remove(src.id)
        try { fs.rmSync(path.join(cacheRoot, src.id), { recursive: true, force: true }) } catch { /* */ }
      }

      return { installed, already, conflicts }
    },
  }
}
