import { describe, it, expect } from 'vitest'
import { openDatabase } from '../database'
import {
  createAutomation, getAutomation, listAutomations, listEnabledAutomations, patchAutomation, deleteAutomation,
  setNextRunAt, insertRun, updateRun, listRunsByAutomation, lastRunOf, sessionIdsFromRuns, automationOriginsBySession,
  type CreateAutomationInput,
} from '../automations'
import type { AutomationSchedule, AutomationTarget } from '@agent-shell/contracts'

const baseInput = (over: Partial<CreateAutomationInput> = {}): CreateAutomationInput => ({
  name: 'n', prompt: 'p', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
  categories: ['监控', '竞品'],
  schedule: { kind: 'weekly', time: '10:00', timezone: 'Asia/Shanghai', weekday: 1 } as AutomationSchedule,
  target: { mode: 'reuse', projectId: 'proj1' } as AutomationTarget,
  enabled: true,
  ...over,
})

describe('automations CRUD', () => {
  it('JSON 字段往返一致', () => {
    const db = openDatabase(':memory:')
    const a = createAutomation(db, baseInput())
    const got = getAutomation(db, a.id)!
    expect(got.categories).toEqual(['监控', '竞品'])
    expect(got.schedule.kind).toBe('weekly')
    expect(got.target.mode).toBe('reuse')
    expect(got.enabled).toBe(true)
    expect(got.nextRunAt).toBe(null)
    db.close()
  })

  it('list 倒序 + listEnabled 过滤', () => {
    const db = openDatabase(':memory:')
    const a1 = createAutomation(db, baseInput({ name: 'a1' }))
    const a2 = createAutomation(db, baseInput({ name: 'a2', enabled: false }))
    const all = listAutomations(db)
    expect(all.map((x) => x.name)).toEqual(['a2', 'a1'])
    const en = listEnabledAutomations(db)
    expect(en.map((x) => x.id)).toEqual([a1.id])
    void a2
    db.close()
  })

  it('patch 改 enabled + schedule，刷新 updatedAt', () => {
    const db = openDatabase(':memory:')
    const a = createAutomation(db, baseInput())
    const patched = patchAutomation(db, a.id, { enabled: false, schedule: { kind: 'hourly', minute: 15 } })!
    expect(patched.enabled).toBe(false)
    expect(patched.schedule).toEqual({ kind: 'hourly', minute: 15 })
    expect(patched.updatedAt).toBeGreaterThanOrEqual(a.updatedAt)
    db.close()
  })

  it('setNextRunAt 写读', () => {
    const db = openDatabase(':memory:')
    const a = createAutomation(db, baseInput())
    setNextRunAt(db, a.id, 999)
    expect(getAutomation(db, a.id)!.nextRunAt).toBe(999)
    setNextRunAt(db, a.id, null)
    expect(getAutomation(db, a.id)!.nextRunAt).toBe(null)
    db.close()
  })

  it('delete 级联删 runs', () => {
    const db = openDatabase(':memory:')
    const a = createAutomation(db, baseInput())
    insertRun(db, { automationId: a.id, trigger: 'manual', status: 'running', projectId: 'p1', startedAt: 1 })
    expect(deleteAutomation(db, a.id)).toBe(true)
    expect(getAutomation(db, a.id)).toBeUndefined()
    expect(listRunsByAutomation(db, a.id)).toEqual([])
    db.close()
  })
})

describe('automation_runs', () => {
  it('insert + update + lastRun', () => {
    const db = openDatabase(':memory:')
    const a = createAutomation(db, baseInput())
    const r = insertRun(db, { automationId: a.id, trigger: 'scheduled', status: 'running', projectId: 'p1', startedAt: 100 })
    updateRun(db, r.id, { status: 'succeeded', sessionId: 's1', completedAt: 200, summary: 'done' })
    const runs = listRunsByAutomation(db, a.id)
    expect(runs).toHaveLength(1)
    expect(runs[0].status).toBe('succeeded')
    expect(runs[0].sessionId).toBe('s1')
    expect(lastRunOf(db, a.id)).toEqual({ status: 'succeeded', completedAt: 200 })
    db.close()
  })

  it('lastRun null 当无 run', () => {
    const db = openDatabase(':memory:')
    const a = createAutomation(db, baseInput())
    expect(lastRunOf(db, a.id)).toBe(null)
    db.close()
  })
})

describe('会话来源派生', () => {
  it('sessionIdsFromRuns + automationOriginsBySession', () => {
    const db = openDatabase(':memory:')
    const a = createAutomation(db, baseInput({ name: '周报' }))
    const r = insertRun(db, { automationId: a.id, trigger: 'scheduled', status: 'running', projectId: 'p1', startedAt: 1 })
    updateRun(db, r.id, { sessionId: 'sess-auto' })
    const ids = sessionIdsFromRuns(db)
    expect(ids.has('sess-auto')).toBe(true)
    expect(ids.has('sess-manual')).toBe(false)
    const origins = automationOriginsBySession(db)
    expect(origins.get('sess-auto')!.automationName).toBe('周报')
    expect(origins.get('sess-auto')!.schedule.kind).toBe('weekly')
    db.close()
  })
})
