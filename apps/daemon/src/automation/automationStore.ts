import fs from 'node:fs'; import path from 'node:path'
import type Database from 'better-sqlite3'
import type { Engine, AutomationTriggerDef, AutomationTarget, AutomationFrontmatter } from '@agent-shell/contracts'

type EnvRequirement = { kind: 'env'; name: string }
import { parseAutomationMd, serializeAutomationMd } from './automationFile'
import { getRuntime, listRuntime, upsertRuntime, setEnabled, setNextRunAt as rtSetNextRunAt, deleteRuntime } from '../db/automationRuntime'
import { deleteRunsOf, listRunsBySession } from '../db/automations'

/** 会话来源派生项（§5.3）：sessionId → 由哪条自动化产出（名/触发器/该次 run 状态，会话历史「自动化」tab 用）。 */
export interface SessionAutomationOrigin {
  automationId: string
  automationName: string
  triggers: AutomationTriggerDef[]
  runStatus: string
  startedAt: number
}

/** 与旧 db/automations.ts 同形 + spec §16/§3 新增字段，供 scheduler/runHandler/api 复用。id = 库内文件夹名。 */
export interface AutomationRow {
  id: string
  name: string
  description?: string
  prompt: string
  engine: Engine
  model: string
  permission: string
  category: string[]                 // 层级路径·单归属
  tags: string[]                     // 扁平多选
  requires: EnvRequirement[]         // env 声明（不含本机绑定）
  triggers: AutomationTriggerDef[]   // 触发器列表（含 startup）
  executor: 'agent' | 'script'
  script?: string
  interpreter?: string
  target: AutomationTarget
  enabled: boolean
  nextRunAt: number | null
  createdAt: number
  updatedAt: number
}

export interface CreateAutomationInput {
  name: string; description?: string; prompt: string; engine: Engine; model: string; permission: string
  category: string[]; tags: string[]; requires?: EnvRequirement[]
  triggers: AutomationTriggerDef[]; executor?: 'agent' | 'script'; script?: string; interpreter?: string
  target: AutomationTarget; enabled: boolean
}
export interface PatchAutomationInput {
  name?: string; description?: string; prompt?: string; engine?: Engine; model?: string; permission?: string
  category?: string[]; tags?: string[]; requires?: EnvRequirement[]
  triggers?: AutomationTriggerDef[]; executor?: 'agent' | 'script'; script?: string; interpreter?: string
  target?: AutomationTarget; enabled?: boolean
}

export interface AutomationStoreDeps { db: Database.Database; automationsDir: () => string }

/** 文件夹名：从 name slug 化，冲突加 -2/-3…（稳定后不随改名变）。 */
function folderNameFor(dir: string, name: string): string {
  const base = (name.trim().toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '') || 'automation').slice(0, 48)
  let eff = base; let i = 2
  while (fs.existsSync(path.join(dir, eff))) eff = `${base}-${i++}`
  return eff
}

export interface AutomationStore {
  list: () => AutomationRow[]
  listEnabled: () => AutomationRow[]
  get: (id: string) => AutomationRow | undefined
  create: (input: CreateAutomationInput) => AutomationRow
  patch: (id: string, patch: PatchAutomationInput) => AutomationRow | undefined
  delete: (id: string) => boolean
  setNextRunAt: (id: string, n: number | null) => void
  /** sessionId → 由哪条自动化产出（会话历史「自动化」tab 渲染来源 + 触发器摘要）。 */
  originsBySession: () => Map<string, SessionAutomationOrigin>
}

export function makeAutomationStore(deps: AutomationStoreDeps): AutomationStore {
  const dir = () => deps.automationsDir()
  const mdPath = (id: string) => path.join(dir(), id, 'AUTOMATION.md')

  const readDef = (id: string): { fm: AutomationFrontmatter; prompt: string } | undefined => {
    try { return ((md) => { const { frontmatter, prompt } = parseAutomationMd(md); return { fm: frontmatter, prompt } })(fs.readFileSync(mdPath(id), 'utf8')) }
    catch { return undefined }
  }

  const rowOf = (id: string): AutomationRow | undefined => {
    const def = readDef(id); if (!def) return undefined
    const rt = getRuntime(deps.db, id)
    return {
      id, name: def.fm.name, description: def.fm.description, prompt: def.prompt,
      engine: def.fm.engine, model: def.fm.model, permission: def.fm.permission,
      category: def.fm.category, tags: def.fm.tags, requires: def.fm.requires,
      triggers: def.fm.triggers, executor: def.fm.executor, script: def.fm.script, interpreter: def.fm.interpreter,
      target: def.fm.target,
      enabled: rt ? rt.enabled : true,            // 缺运行态行（外部导入）默认启用
      nextRunAt: rt ? rt.nextRunAt : null,
      createdAt: rt ? rt.createdAt : 0, updatedAt: rt ? rt.updatedAt : 0,
    }
  }

  const ids = (): string[] => {
    try { return fs.readdirSync(dir(), { withFileTypes: true }).filter((e) => (e.isDirectory() || e.isSymbolicLink()) && fs.existsSync(path.join(dir(), e.name, 'AUTOMATION.md'))).map((e) => e.name) }
    catch { return [] }
  }

  return {
    list: () => ids().map(rowOf).filter((r): r is AutomationRow => !!r),
    listEnabled: () => ids().map(rowOf).filter((r): r is AutomationRow => !!r && r.enabled),
    get: (id) => rowOf(id),
    create: (input) => {
      const id = folderNameFor(dir(), input.name)
      const folder = path.join(dir(), id); fs.mkdirSync(folder, { recursive: true })
      const fm: AutomationFrontmatter = {
        name: input.name, description: input.description,
        engine: input.engine, model: input.model, permission: input.permission,
        category: input.category, tags: input.tags, requires: input.requires ?? [],
        triggers: input.triggers, executor: input.executor ?? 'agent', script: input.script, interpreter: input.interpreter,
        target: input.target,
      }
      fs.writeFileSync(path.join(folder, 'AUTOMATION.md'), serializeAutomationMd(fm, input.prompt))
      upsertRuntime(deps.db, id, { enabled: input.enabled })
      return rowOf(id)!
    },
    patch: (id, patch) => {
      const def = readDef(id); if (!def) return undefined
      // 定义字段变更 → 重写文件（保留未变字段，含 description）
      const nextFm: AutomationFrontmatter = {
        ...def.fm,
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.engine !== undefined ? { engine: patch.engine } : {}),
        ...(patch.model !== undefined ? { model: patch.model } : {}),
        ...(patch.permission !== undefined ? { permission: patch.permission } : {}),
        ...(patch.category !== undefined ? { category: patch.category } : {}),
        ...(patch.tags !== undefined ? { tags: patch.tags } : {}),
        ...(patch.requires !== undefined ? { requires: patch.requires } : {}),
        ...(patch.triggers !== undefined ? { triggers: patch.triggers } : {}),
        ...(patch.executor !== undefined ? { executor: patch.executor } : {}),
        ...(patch.script !== undefined ? { script: patch.script } : {}),
        ...(patch.interpreter !== undefined ? { interpreter: patch.interpreter } : {}),
        ...(patch.target !== undefined ? { target: patch.target } : {}),
      }
      const nextPrompt = patch.prompt !== undefined ? patch.prompt : def.prompt
      fs.writeFileSync(mdPath(id), serializeAutomationMd(nextFm, nextPrompt))
      // 运行态变更
      if (patch.enabled !== undefined) {
        if (getRuntime(deps.db, id)) setEnabled(deps.db, id, patch.enabled)
        else upsertRuntime(deps.db, id, { enabled: patch.enabled })
      }
      return rowOf(id)
    },
    delete: (id) => {
      const folder = path.join(dir(), id)
      if (!fs.existsSync(path.join(folder, 'AUTOMATION.md'))) return false
      fs.rmSync(folder, { recursive: true, force: true })
      deleteRuntime(deps.db, id); deleteRunsOf(deps.db, id)
      return true
    },
    setNextRunAt: (id, n) => {
      if (!getRuntime(deps.db, id)) upsertRuntime(deps.db, id, { enabled: true })
      rtSetNextRunAt(deps.db, id, n)
    },
    originsBySession: () => {
      // 连 runs（db）与文件定义（store）：每个有会话的 run 取其自动化定义的名/触发器；
      // 一条会话可能有多条 run，取最近一次（startedAt 最大）为准。
      const map = new Map<string, SessionAutomationOrigin>()
      for (const run of listRunsBySession(deps.db)) {
        const row = rowOf(run.automationId)
        if (!row || !run.sessionId) continue
        const prev = map.get(run.sessionId)
        if (!prev || run.startedAt > prev.startedAt) {
          map.set(run.sessionId, { automationId: row.id, automationName: row.name, triggers: row.triggers, runStatus: run.status, startedAt: run.startedAt })
        }
      }
      return map
    },
  }
}
