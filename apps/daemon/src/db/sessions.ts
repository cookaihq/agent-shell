import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CreateSessionInput, SessionRow, SessionStatus } from './types'

interface SessionDbRow {
  id: string; project_id: string; engine: string; model: string; title: string
  pinned: number; status: string; resumable_id: string | null; created_at: number
}
const toRow = (r: SessionDbRow): SessionRow => ({
  id: r.id, projectId: r.project_id, engine: r.engine as SessionRow['engine'], model: r.model,
  title: r.title, pinned: r.pinned === 1, status: r.status as SessionStatus,
  resumableId: r.resumable_id, createdAt: r.created_at,
})

export function createSession(db: Database.Database, input: CreateSessionInput): SessionRow {
  const row: SessionRow = {
    id: randomUUID(), projectId: input.projectId, engine: input.engine, model: input.model,
    title: input.title ?? '新会话', pinned: false, status: 'idle', resumableId: null, createdAt: Date.now(),
  }
  db.prepare(
    'INSERT INTO sessions (id, project_id, engine, model, title, pinned, status, resumable_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(row.id, row.projectId, row.engine, row.model, row.title, row.pinned ? 1 : 0, row.status, row.resumableId, row.createdAt)
  return row
}

export function getSession(db: Database.Database, id: string): SessionRow | undefined {
  const r = db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionDbRow | undefined
  return r ? toRow(r) : undefined
}

/** 某项目的会话，最近创建在前（历史会话列表用）。 */
export function getSessionsByProject(db: Database.Database, projectId: string): SessionRow[] {
  const rows = db.prepare('SELECT * FROM sessions WHERE project_id = ? ORDER BY created_at DESC, rowid DESC').all(projectId) as SessionDbRow[]
  return rows.map(toRow)
}

export function setResumableId(db: Database.Database, id: string, resumableId: string): void {
  db.prepare('UPDATE sessions SET resumable_id = ? WHERE id = ?').run(resumableId, id)
}

export function setSessionStatus(db: Database.Database, id: string, status: SessionStatus): void {
  db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(status, id)
}

export function setSessionPinned(db: Database.Database, id: string, pinned: boolean): void {
  db.prepare('UPDATE sessions SET pinned = ? WHERE id = ?').run(pinned ? 1 : 0, id)
}

export function setSessionTitle(db: Database.Database, id: string, title: string): void {
  db.prepare('UPDATE sessions SET title = ? WHERE id = ?').run(title, id)
}
