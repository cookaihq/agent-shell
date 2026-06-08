import type Database from 'better-sqlite3'

export interface RuntimeRow {
  id: string
  enabled: boolean
  nextRunAt: number | null
  createdAt: number
  updatedAt: number
}

interface RuntimeDbRow { id: string; enabled: number; next_run_at: number | null; created_at: number; updated_at: number }
const toRuntime = (r: RuntimeDbRow): RuntimeRow => ({
  id: r.id, enabled: r.enabled === 1, nextRunAt: r.next_run_at, createdAt: r.created_at, updatedAt: r.updated_at,
})

export function getRuntime(db: Database.Database, id: string): RuntimeRow | undefined {
  const r = db.prepare('SELECT * FROM automation_runtime WHERE id = ?').get(id) as RuntimeDbRow | undefined
  return r ? toRuntime(r) : undefined
}

export function listRuntime(db: Database.Database): RuntimeRow[] {
  return (db.prepare('SELECT * FROM automation_runtime').all() as RuntimeDbRow[]).map(toRuntime)
}

/** 建或更新运行态行（仅 enabled；next_run_at 由 setNextRunAt 管）。created_at 首建时写、之后不动。 */
export function upsertRuntime(db: Database.Database, id: string, input: { enabled: boolean }): RuntimeRow {
  const now = Date.now()
  db.prepare(
    `INSERT INTO automation_runtime (id, enabled, next_run_at, created_at, updated_at)
     VALUES (?, ?, NULL, ?, ?)
     ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, updated_at = excluded.updated_at`,
  ).run(id, input.enabled ? 1 : 0, now, now)
  return getRuntime(db, id)!
}

export function setEnabled(db: Database.Database, id: string, enabled: boolean): void {
  db.prepare('UPDATE automation_runtime SET enabled = ?, updated_at = ? WHERE id = ?').run(enabled ? 1 : 0, Date.now(), id)
}

export function setNextRunAt(db: Database.Database, id: string, nextRunAt: number | null): void {
  db.prepare('UPDATE automation_runtime SET next_run_at = ?, updated_at = ? WHERE id = ?').run(nextRunAt, Date.now(), id)
}

export function deleteRuntime(db: Database.Database, id: string): void {
  db.prepare('DELETE FROM automation_runtime WHERE id = ?').run(id)
}
