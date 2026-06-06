import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type {
  Engine, AutomationSchedule, AutomationTarget, AutomationRunStatus, AutomationTrigger, AutomationLastRun,
} from '@agent-shell/contracts'

/** 内存中的自动化行（categories/schedule/target 已从 JSON 解析）。 */
export interface AutomationRow {
  id: string
  name: string
  prompt: string
  engine: Engine
  model: string
  permission: string
  categories: string[]
  schedule: AutomationSchedule
  target: AutomationTarget
  enabled: boolean
  nextRunAt: number | null
  createdAt: number
  updatedAt: number
}

export interface CreateAutomationInput {
  name: string
  prompt: string
  engine: Engine
  model: string
  permission: string
  categories: string[]
  schedule: AutomationSchedule
  target: AutomationTarget
  enabled: boolean
}

/** 可编辑字段（全可选）；不传的不动。 */
export interface PatchAutomationInput {
  name?: string
  prompt?: string
  engine?: Engine
  model?: string
  permission?: string
  categories?: string[]
  schedule?: AutomationSchedule
  target?: AutomationTarget
  enabled?: boolean
}

export interface AutomationRunRow {
  id: string
  automationId: string
  trigger: AutomationTrigger
  status: AutomationRunStatus
  projectId: string
  sessionId: string | null
  startedAt: number
  completedAt: number | null
  summary: string | null
  error: string | null
}

interface AutomationDbRow {
  id: string; name: string; prompt: string; engine: string; model: string; permission: string
  categories: string; schedule: string; target: string
  enabled: number; next_run_at: number | null; created_at: number; updated_at: number
}
interface RunDbRow {
  id: string; automation_id: string; trigger: string; status: string; project_id: string
  session_id: string | null; started_at: number; completed_at: number | null
  summary: string | null; error: string | null
}

const toAutomation = (r: AutomationDbRow): AutomationRow => ({
  id: r.id, name: r.name, prompt: r.prompt, engine: r.engine as Engine, model: r.model, permission: r.permission,
  categories: JSON.parse(r.categories) as string[],
  schedule: JSON.parse(r.schedule) as AutomationSchedule,
  target: JSON.parse(r.target) as AutomationTarget,
  enabled: r.enabled === 1, nextRunAt: r.next_run_at, createdAt: r.created_at, updatedAt: r.updated_at,
})
const toRun = (r: RunDbRow): AutomationRunRow => ({
  id: r.id, automationId: r.automation_id, trigger: r.trigger as AutomationTrigger, status: r.status as AutomationRunStatus,
  projectId: r.project_id, sessionId: r.session_id, startedAt: r.started_at, completedAt: r.completed_at,
  summary: r.summary, error: r.error,
})

// ── automations CRUD ────────────────────────────────────────────────────────
export function createAutomation(db: Database.Database, input: CreateAutomationInput): AutomationRow {
  const now = Date.now()
  const row: AutomationRow = {
    id: randomUUID(), ...input, nextRunAt: null, createdAt: now, updatedAt: now,
  }
  db.prepare(
    `INSERT INTO automations (id, name, prompt, engine, model, permission, categories, schedule, target, enabled, next_run_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    row.id, row.name, row.prompt, row.engine, row.model, row.permission,
    JSON.stringify(row.categories), JSON.stringify(row.schedule), JSON.stringify(row.target),
    row.enabled ? 1 : 0, row.nextRunAt, row.createdAt, row.updatedAt,
  )
  return row
}

export function getAutomation(db: Database.Database, id: string): AutomationRow | undefined {
  const r = db.prepare('SELECT * FROM automations WHERE id = ?').get(id) as AutomationDbRow | undefined
  return r ? toAutomation(r) : undefined
}

/** 全部自动化，最近创建在前。 */
export function listAutomations(db: Database.Database): AutomationRow[] {
  const rows = db.prepare('SELECT * FROM automations ORDER BY created_at DESC, rowid DESC').all() as AutomationDbRow[]
  return rows.map(toAutomation)
}

/** 仅启用中的自动化（调度器 armAll 用）。 */
export function listEnabledAutomations(db: Database.Database): AutomationRow[] {
  return listAutomations(db).filter((a) => a.enabled)
}

/** 编辑：只更新传入字段；总是刷新 updated_at。返回更新后的行（不存在=undefined）。 */
export function patchAutomation(db: Database.Database, id: string, patch: PatchAutomationInput): AutomationRow | undefined {
  const cur = getAutomation(db, id)
  if (!cur) return undefined
  const next: AutomationRow = {
    ...cur,
    ...(patch.name !== undefined ? { name: patch.name } : {}),
    ...(patch.prompt !== undefined ? { prompt: patch.prompt } : {}),
    ...(patch.engine !== undefined ? { engine: patch.engine } : {}),
    ...(patch.model !== undefined ? { model: patch.model } : {}),
    ...(patch.permission !== undefined ? { permission: patch.permission } : {}),
    ...(patch.categories !== undefined ? { categories: patch.categories } : {}),
    ...(patch.schedule !== undefined ? { schedule: patch.schedule } : {}),
    ...(patch.target !== undefined ? { target: patch.target } : {}),
    ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    updatedAt: Date.now(),
  }
  db.prepare(
    `UPDATE automations SET name=?, prompt=?, engine=?, model=?, permission=?, categories=?, schedule=?, target=?, enabled=?, updated_at=? WHERE id=?`,
  ).run(
    next.name, next.prompt, next.engine, next.model, next.permission,
    JSON.stringify(next.categories), JSON.stringify(next.schedule), JSON.stringify(next.target),
    next.enabled ? 1 : 0, next.updatedAt, id,
  )
  return next
}

/** 调度器维护的下次触发时间（ms）；null=未排/暂停。 */
export function setNextRunAt(db: Database.Database, id: string, nextRunAt: number | null): void {
  db.prepare('UPDATE automations SET next_run_at = ? WHERE id = ?').run(nextRunAt, id)
}

/** 硬删自动化：事务内级联删其全部 runs，再删行。返回是否真删到。 */
export function deleteAutomation(db: Database.Database, id: string): boolean {
  return db.transaction(() => {
    db.prepare('DELETE FROM automation_runs WHERE automation_id = ?').run(id)
    return db.prepare('DELETE FROM automations WHERE id = ?').run(id).changes > 0
  })()
}

// ── automation_runs ───────────────────────────────────────────────────────--
export interface InsertRunInput {
  automationId: string
  trigger: AutomationTrigger
  status: AutomationRunStatus
  projectId: string
  sessionId?: string | null
  startedAt: number
}
export function insertRun(db: Database.Database, input: InsertRunInput): AutomationRunRow {
  const row: AutomationRunRow = {
    id: randomUUID(), automationId: input.automationId, trigger: input.trigger, status: input.status,
    projectId: input.projectId, sessionId: input.sessionId ?? null, startedAt: input.startedAt,
    completedAt: null, summary: null, error: null,
  }
  db.prepare(
    `INSERT INTO automation_runs (id, automation_id, trigger, status, project_id, session_id, started_at, completed_at, summary, error)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(row.id, row.automationId, row.trigger, row.status, row.projectId, row.sessionId, row.startedAt, row.completedAt, row.summary, row.error)
  return row
}

export interface UpdateRunInput {
  status?: AutomationRunStatus
  projectId?: string
  sessionId?: string | null
  completedAt?: number | null
  summary?: string | null
  error?: string | null
}
/** 更新 run 的字段（只动传入的）。 */
export function updateRun(db: Database.Database, id: string, patch: UpdateRunInput): void {
  if (patch.status !== undefined) db.prepare('UPDATE automation_runs SET status = ? WHERE id = ?').run(patch.status, id)
  if (patch.projectId !== undefined) db.prepare('UPDATE automation_runs SET project_id = ? WHERE id = ?').run(patch.projectId, id)
  if (patch.sessionId !== undefined) db.prepare('UPDATE automation_runs SET session_id = ? WHERE id = ?').run(patch.sessionId, id)
  if (patch.completedAt !== undefined) db.prepare('UPDATE automation_runs SET completed_at = ? WHERE id = ?').run(patch.completedAt, id)
  if (patch.summary !== undefined) db.prepare('UPDATE automation_runs SET summary = ? WHERE id = ?').run(patch.summary, id)
  if (patch.error !== undefined) db.prepare('UPDATE automation_runs SET error = ? WHERE id = ?').run(patch.error, id)
}

/** 某条自动化的运行历史，最近开始在前。 */
export function listRunsByAutomation(db: Database.Database, automationId: string): AutomationRunRow[] {
  const rows = db.prepare('SELECT * FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC, rowid DESC').all(automationId) as RunDbRow[]
  return rows.map(toRun)
}

/** 某条自动化最近一次跑（列表卡「上次」状态）；无则 null。 */
export function lastRunOf(db: Database.Database, automationId: string): AutomationLastRun | null {
  const r = db.prepare('SELECT status, completed_at FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC, rowid DESC LIMIT 1').get(automationId) as { status: string; completed_at: number | null } | undefined
  return r ? { status: r.status as AutomationRunStatus, completedAt: r.completed_at } : null
}

// ── 会话来源派生（§5.3）──────────────────────────────────────────────────────
/** 被任何 run 引用过的 session_id 集合。 */
export function sessionIdsFromRuns(db: Database.Database): Set<string> {
  const rows = db.prepare('SELECT DISTINCT session_id FROM automation_runs WHERE session_id IS NOT NULL').all() as { session_id: string }[]
  return new Set(rows.map((r) => r.session_id))
}

/** sessionId → 它由哪条自动化产出（名字 + schedule + 该次 run 状态，供会话历史「自动化」tab 展示 needs-review 等）。 */
export interface SessionAutomationOrigin { automationId: string; automationName: string; schedule: AutomationSchedule; runStatus: AutomationRunStatus; startedAt: number }
export function automationOriginsBySession(db: Database.Database): Map<string, SessionAutomationOrigin> {
  const rows = db.prepare(
    `SELECT r.session_id AS sid, r.status AS status, r.started_at AS startedAt, a.id AS aid, a.name AS name, a.schedule AS schedule
     FROM automation_runs r JOIN automations a ON a.id = r.automation_id
     WHERE r.session_id IS NOT NULL`,
  ).all() as { sid: string; status: string; startedAt: number; aid: string; name: string; schedule: string }[]
  const map = new Map<string, SessionAutomationOrigin>()
  for (const r of rows) {
    // 一条会话只可能由一条 run 产出（每跑建一条会话）；若有多条以最后一条为准（幂等）
    map.set(r.sid, { automationId: r.aid, automationName: r.name, schedule: JSON.parse(r.schedule) as AutomationSchedule, runStatus: r.status as AutomationRunStatus, startedAt: r.startedAt })
  }
  return map
}
