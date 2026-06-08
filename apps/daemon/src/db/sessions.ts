import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CreateSessionInput, SessionRow, SessionStatus } from './types'

interface SessionDbRow {
  id: string; project_id: string; engine: string; model: string; title: string
  pinned: number; status: string; resumable_id: string | null
  permission_mode: string | null; effort: string | null
  codex_sandbox: string | null; codex_approval: string | null
  claude_code_version: string | null; sdk_version: string | null; created_at: number
}
const toRow = (r: SessionDbRow): SessionRow => ({
  id: r.id, projectId: r.project_id, engine: r.engine as SessionRow['engine'], model: r.model,
  title: r.title, pinned: r.pinned === 1, status: r.status as SessionStatus,
  resumableId: r.resumable_id, permissionMode: r.permission_mode ?? null, effort: r.effort ?? null,
  sandbox: r.codex_sandbox ?? null, approval: r.codex_approval ?? null,
  claudeCodeVersion: r.claude_code_version ?? null, sdkVersion: r.sdk_version ?? null,
  createdAt: r.created_at,
})

export function createSession(db: Database.Database, input: CreateSessionInput): SessionRow {
  const row: SessionRow = {
    id: randomUUID(), projectId: input.projectId, engine: input.engine, model: input.model,
    title: input.title ?? '新会话', pinned: false, status: 'idle', resumableId: null,
    permissionMode: input.permissionMode ?? null, effort: input.effort ?? null,
    sandbox: input.sandbox ?? null, approval: input.approval ?? null,
    claudeCodeVersion: null, sdkVersion: null, createdAt: Date.now(),
  }
  db.prepare(
    'INSERT INTO sessions (id, project_id, engine, model, title, pinned, status, resumable_id, permission_mode, effort, codex_sandbox, codex_approval, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(row.id, row.projectId, row.engine, row.model, row.title, row.pinned ? 1 : 0, row.status, row.resumableId, row.permissionMode, row.effort, row.sandbox, row.approval, row.createdAt)
  return row
}

/** 持久化会话级运行时档位（Issue 13/29）：只更新传入的字段，null/undefined 不动。 */
export function setSessionRuntime(db: Database.Database, id: string, cfg: { permissionMode?: string; effort?: string; model?: string; sandbox?: string; approval?: string }): void {
  if (cfg.permissionMode !== undefined) db.prepare('UPDATE sessions SET permission_mode = ? WHERE id = ?').run(cfg.permissionMode, id)
  if (cfg.effort !== undefined) db.prepare('UPDATE sessions SET effort = ? WHERE id = ?').run(cfg.effort, id)
  if (cfg.model !== undefined) db.prepare('UPDATE sessions SET model = ? WHERE id = ?').run(cfg.model, id)
  if (cfg.sandbox !== undefined) db.prepare('UPDATE sessions SET codex_sandbox = ? WHERE id = ?').run(cfg.sandbox, id)
  if (cfg.approval !== undefined) db.prepare('UPDATE sessions SET codex_approval = ? WHERE id = ?').run(cfg.approval, id)
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

/** 变身：同时更新 engine+model，并将引擎专属档案（permission_mode/effort/codex_sandbox/codex_approval）清空为 NULL，
 *  消除跨引擎非法状态（Part B T5a）。 */
export function changeSessionEngine(db: Database.Database, id: string, engine: SessionRow['engine'], model: string): void {
  db.prepare(
    'UPDATE sessions SET engine = ?, model = ?, permission_mode = NULL, effort = NULL, codex_sandbox = NULL, codex_approval = NULL WHERE id = ?',
  ).run(engine, model, id)
}

export function setSessionVersions(db: Database.Database, id: string, v: { claudeCodeVersion?: string; sdkVersion?: string }): void {
  if (v.claudeCodeVersion !== undefined) db.prepare('UPDATE sessions SET claude_code_version = ? WHERE id = ?').run(v.claudeCodeVersion, id)
  if (v.sdkVersion !== undefined) db.prepare('UPDATE sessions SET sdk_version = ? WHERE id = ?').run(v.sdkVersion, id)
}

/**
 * 硬删会话：在一个事务里级联清掉它的 usage，再删会话行本身。
 * usage 仅靠 session_id 关联、无外键 CASCADE，必须手动删，否则留下孤儿数据。
 * 返回是否真删到了会话（false = 该 id 不存在）。
 */
export function deleteSession(db: Database.Database, id: string): boolean {
  const tx = db.transaction((sid: string): boolean => {
    db.prepare('DELETE FROM usage WHERE session_id = ?').run(sid)
    return db.prepare('DELETE FROM sessions WHERE id = ?').run(sid).changes > 0
  })
  return tx(id)
}
