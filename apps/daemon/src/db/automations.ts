import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AutomationRunStatus, AutomationRunTrigger, AutomationLastRun } from '@agent-shell/contracts'

// 定义 CRUD + 运行态已迁出（定义→磁盘 automationStore；运行态→db/automationRuntime）。
// 本文件只保留「运行历史 automation_runs」相关读写。automation_id 现在语义上 = 库内文件夹名。

export interface AutomationRunRow {
  id: string
  automationId: string
  trigger: AutomationRunTrigger
  status: AutomationRunStatus
  projectId: string
  sessionId: string | null
  startedAt: number
  completedAt: number | null
  summary: string | null
  error: string | null
}

interface RunDbRow {
  id: string; automation_id: string; trigger: string; status: string; project_id: string
  session_id: string | null; started_at: number; completed_at: number | null
  summary: string | null; error: string | null
}

const toRun = (r: RunDbRow): AutomationRunRow => ({
  id: r.id, automationId: r.automation_id, trigger: r.trigger as AutomationRunTrigger, status: r.status as AutomationRunStatus,
  projectId: r.project_id, sessionId: r.session_id, startedAt: r.started_at, completedAt: r.completed_at,
  summary: r.summary, error: r.error,
})

// ── automation_runs ───────────────────────────────────────────────────────--
export interface InsertRunInput {
  automationId: string
  trigger: AutomationRunTrigger
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

/** 删某条自动化的全部 run（store.delete 级联用；定义删除已迁到 automationStore）。 */
export function deleteRunsOf(db: Database.Database, automationId: string): void {
  db.prepare('DELETE FROM automation_runs WHERE automation_id = ?').run(automationId)
}

// ── 会话来源派生（§5.3）──────────────────────────────────────────────────────
/** 被任何 run 引用过的 session_id 集合。 */
export function sessionIdsFromRuns(db: Database.Database): Set<string> {
  const rows = db.prepare('SELECT DISTINCT session_id FROM automation_runs WHERE session_id IS NOT NULL').all() as { session_id: string }[]
  return new Set(rows.map((r) => r.session_id))
}

/** 取所有有会话的 run（会话来源派生用：sessionId → 由哪条自动化产出，store.originsBySession 消费）。 */
export function listRunsBySession(db: Database.Database): AutomationRunRow[] {
  return (db.prepare('SELECT * FROM automation_runs WHERE session_id IS NOT NULL').all() as RunDbRow[]).map(toRun)
}
