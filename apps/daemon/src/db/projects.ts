import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CreateProjectInput, ProjectRow } from './types'
import type { Engine, ProjectStatus } from '@agent-shell/contracts'
import { getSessionsByProject } from './sessions'

interface ProjectDbRow { id: string; name: string; path: string; selected_agent: string | null; created_at: number }
const toRow = (r: ProjectDbRow): ProjectRow => ({
  id: r.id,
  name: r.name,
  path: r.path,
  selectedAgent: r.selected_agent as Engine | null,
  createdAt: r.created_at,
})

/** 项目目录名 = 32 位 uuid（去连字符，与显示名解耦）。 */
export function uuid32(): string {
  return randomUUID().replace(/-/g, '')
}

export function createProject(db: Database.Database, input: CreateProjectInput): ProjectRow {
  const row: ProjectRow = {
    id: input.id ?? uuid32(),
    name: input.name,
    path: input.path,
    selectedAgent: input.selectedAgent ?? null,
    createdAt: Date.now(),
  }
  db.prepare('INSERT INTO projects (id, name, path, selected_agent, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(row.id, row.name, row.path, row.selectedAgent, row.createdAt)
  return row
}

/** 更新项目级持久化选中 Agent（Part B T1）。 */
export function setProjectSelectedAgent(db: Database.Database, id: string, engine: Engine): void {
  db.prepare('UPDATE projects SET selected_agent = ? WHERE id = ?').run(engine, id)
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

/**
 * 硬删项目：事务内级联删该项目的全部会话（usage + sessions），再删项目行。
 * 对齐 deleteSession 的级联写法（usage 仅靠 session_id 关联、无外键 CASCADE，须手动删）。
 * 返回项目行是否真的删掉（不存在 → false）。磁盘目录的删除由调用方（路由层）负责，DB 与文件分离。
 */
export function deleteProject(db: Database.Database, id: string): boolean {
  const sessions = getSessionsByProject(db, id)
  return db.transaction(() => {
    for (const s of sessions) {
      db.prepare('DELETE FROM usage WHERE session_id = ?').run(s.id)
      db.prepare('DELETE FROM sessions WHERE id = ?').run(s.id)
    }
    return db.prepare('DELETE FROM projects WHERE id = ?').run(id).changes > 0
  })()
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
