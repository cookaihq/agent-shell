import { describe, it, expect, beforeEach } from 'vitest'
import Database from 'better-sqlite3'
import { initSchema } from '../schema'
import { createProject, listProjectsWithStatus } from '../projects'
import { createSession, setSessionStatus } from '../sessions'

let db: Database.Database
beforeEach(() => { db = new Database(':memory:'); initSchema(db) })

describe('listProjectsWithStatus', () => {
  it('无会话 → idle + engine claude', () => {
    createProject(db, { id: 'p1', name: '空项目', path: '/x' })
    const out = listProjectsWithStatus(db, () => false)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ id: 'p1', status: 'idle', engine: 'claude' })
  })

  it('取最近会话的 DB status + engine', () => {
    createProject(db, { id: 'p1', name: 'P', path: '/x' })
    const s1 = createSession(db, { projectId: 'p1', engine: 'claude', model: 'opus' })
    const s2 = createSession(db, { projectId: 'p1', engine: 'codex', model: 'gpt-5.5' })
    setSessionStatus(db, s1.id, 'completed')
    setSessionStatus(db, s2.id, 'failed')   // s2 更晚创建 → 取它
    const out = listProjectsWithStatus(db, () => false)
    expect(out[0]).toMatchObject({ status: 'failed', engine: 'codex' })
  })

  it('任一会话 isRunning → running（优先于 DB status）', () => {
    createProject(db, { id: 'p1', name: 'P', path: '/x' })
    const s1 = createSession(db, { projectId: 'p1', engine: 'claude', model: 'opus' })
    setSessionStatus(db, s1.id, 'completed')
    const out = listProjectsWithStatus(db, (id) => id === s1.id)
    expect(out[0].status).toBe('running')
  })
})
