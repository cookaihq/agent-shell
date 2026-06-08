import { describe, it, expect } from 'vitest'
import { openDatabase } from '../database'
import {
  insertRun, updateRun, listRunsByAutomation, lastRunOf, sessionIdsFromRuns, deleteRunsOf,
} from '../automations'

// 定义 CRUD 已迁出本文件（→ automationStore / automationRuntime），故此处只测 runs。
// runs 不再外键到定义，automationId 直接用字符串（= 库内文件夹名）。

describe('automation_runs', () => {
  it('insert + update + lastRun', () => {
    const db = openDatabase(':memory:')
    const r = insertRun(db, { automationId: 'mon', trigger: 'scheduled', status: 'running', projectId: 'p1', startedAt: 100 })
    updateRun(db, r.id, { status: 'succeeded', sessionId: 's1', completedAt: 200, summary: 'done' })
    const runs = listRunsByAutomation(db, 'mon')
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('succeeded')
    expect(runs[0].sessionId).toBe('s1')
    expect(lastRunOf(db, 'mon')).toEqual({ status: 'succeeded', completedAt: 200 })
    db.close()
  })

  it('lastRun null 当无 run', () => {
    const db = openDatabase(':memory:')
    expect(lastRunOf(db, 'mon')).toBe(null)
    db.close()
  })

  it('sessionIdsFromRuns 收集有会话的 run', () => {
    const db = openDatabase(':memory:')
    const r = insertRun(db, { automationId: 'mon', trigger: 'scheduled', status: 'running', projectId: 'p1', startedAt: 1 })
    updateRun(db, r.id, { sessionId: 'sess-auto' })
    expect(sessionIdsFromRuns(db).has('sess-auto')).toBe(true)
    db.close()
  })

  it('deleteRunsOf 删该任务所有 run', () => {
    const db = openDatabase(':memory:')
    insertRun(db, { automationId: 'mon', trigger: 'manual', status: 'running', projectId: 'p1', startedAt: 1 })
    deleteRunsOf(db, 'mon')
    expect(listRunsByAutomation(db, 'mon')).toEqual([])
    db.close()
  })
})
