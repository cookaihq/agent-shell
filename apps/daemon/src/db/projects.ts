import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CreateProjectInput, ProjectRow } from './types'
import type { Engine, ProjectStatus } from '@agent-shell/contracts'
import { getSessionsByProject } from './sessions'

interface ProjectDbRow { id: string; name: string; path: string; created_at: number }
const toRow = (r: ProjectDbRow): ProjectRow => ({ id: r.id, name: r.name, path: r.path, createdAt: r.created_at })

/** 项目目录名 = 32 位 uuid（去连字符，与显示名解耦）。 */
export function uuid32(): string {
  return randomUUID().replace(/-/g, '')
}

export function createProject(db: Database.Database, input: CreateProjectInput): ProjectRow {
  const row: ProjectRow = { id: input.id ?? uuid32(), name: input.name, path: input.path, createdAt: Date.now() }
  db.prepare('INSERT INTO projects (id, name, path, created_at) VALUES (?, ?, ?, ?)')
    .run(row.id, row.name, row.path, row.createdAt)
  return row
}

export function getProject(db: Database.Database, id: string): ProjectRow | undefined {
  const r = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as ProjectDbRow | undefined
  return r ? toRow(r) : undefined
}

/** 项目列表，最近创建在前。 */
export function listProjects(db: Database.Database): ProjectRow[] {
  const rows = db.prepare('SELECT * FROM projects ORDER BY created_at DESC, rowid DESC').all() as ProjectDbRow[]
  return rows.map(toRow)
}

export function renameProject(db: Database.Database, id: string, name: string): void {
  db.prepare('UPDATE projects SET name = ? WHERE id = ?').run(name, id)
}

export interface ProjectWithStatus extends ProjectRow {
  status: ProjectStatus
  engine: Engine
}

/** 列表项 = 项目 + 派生 status/engine（聚合会话；isRunning 读内存运行时态）。 */
export function listProjectsWithStatus(
  db: Database.Database,
  isRunning: (sessionId: string) => boolean,
): ProjectWithStatus[] {
  return listProjects(db).map((p) => {
    const sessions = getSessionsByProject(db, p.id)   // 已按 created_at DESC, rowid DESC 排序：最近在前
    if (sessions.length === 0) return { ...p, status: 'idle', engine: 'claude' }
    const anyRunning = sessions.some((s) => isRunning(s.id))
    const latest = sessions[0]   // 最近创建会话（含同毫秒 rowid 平手），不再自行重排
    const status: ProjectStatus = anyRunning ? 'running' : latest.status
    return { ...p, status, engine: latest.engine }
  })
}
