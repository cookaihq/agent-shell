import { describe, it, expect } from 'vitest'
import { AutomationSchedule, AutomationTarget, CreateAutomationReq, AutomationDTO, AutomationRunDTO, SessionOrigin } from '../dto'

describe('AutomationSchedule', () => {
  it('接受四档', () => {
    expect(AutomationSchedule.safeParse({ kind: 'hourly', minute: 30 }).success).toBe(true)
    expect(AutomationSchedule.safeParse({ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }).success).toBe(true)
    expect(AutomationSchedule.safeParse({ kind: 'weekdays', time: '08:00', timezone: 'Asia/Shanghai' }).success).toBe(true)
    expect(AutomationSchedule.safeParse({ kind: 'weekly', time: '10:00', timezone: 'Asia/Shanghai', weekday: 1 }).success).toBe(true)
  })
  it('hourly minute 越界拒绝', () => {
    expect(AutomationSchedule.safeParse({ kind: 'hourly', minute: 60 }).success).toBe(false)
  })
  it('time 格式非法拒绝', () => {
    expect(AutomationSchedule.safeParse({ kind: 'daily', time: '9:0', timezone: 'Asia/Shanghai' }).success).toBe(false)
  })
  it('weekly 缺 weekday 拒绝', () => {
    expect(AutomationSchedule.safeParse({ kind: 'weekly', time: '10:00', timezone: 'Asia/Shanghai' }).success).toBe(false)
  })
})

describe('AutomationTarget', () => {
  it('create_each_run / reuse', () => {
    expect(AutomationTarget.safeParse({ mode: 'create_each_run' }).success).toBe(true)
    expect(AutomationTarget.safeParse({ mode: 'reuse', projectId: 'p1' }).success).toBe(true)
    expect(AutomationTarget.safeParse({ mode: 'reuse' }).success).toBe(false)
  })
})

describe('CreateAutomationReq', () => {
  it('默认值：categories=[] enabled=true', () => {
    const r = CreateAutomationReq.parse({
      name: 'x', prompt: 'p', engine: 'claude', model: 'opus',
      permission: 'bypassPermissions',
      schedule: { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' },
      target: { mode: 'create_each_run' },
    })
    expect(r.categories).toEqual([])
    expect(r.enabled).toBe(true)
  })
  it('缺 name 拒绝', () => {
    expect(CreateAutomationReq.safeParse({ prompt: 'p', engine: 'claude', model: 'opus', permission: 'x', schedule: { kind: 'hourly', minute: 0 }, target: { mode: 'create_each_run' } }).success).toBe(false)
  })
})

describe('AutomationDTO / AutomationRunDTO / SessionOrigin', () => {
  it('AutomationDTO 形状', () => {
    const dto = {
      id: 'a1', name: 'n', prompt: 'p', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
      categories: ['监控'], schedule: { kind: 'hourly', minute: 5 }, target: { mode: 'create_each_run' },
      enabled: true, nextRunAt: 123, createdAt: 1, updatedAt: 2, lastRun: null,
    }
    expect(AutomationDTO.safeParse(dto).success).toBe(true)
  })
  it('AutomationRunDTO 形状', () => {
    const run = {
      id: 'r1', automationId: 'a1', trigger: 'scheduled', status: 'needs-review',
      projectId: 'p1', sessionId: null, startedAt: 1, completedAt: null, summary: null, error: null,
    }
    expect(AutomationRunDTO.safeParse(run).success).toBe(true)
  })
  it('SessionOrigin', () => {
    expect(SessionOrigin.safeParse('automation').success).toBe(true)
    expect(SessionOrigin.safeParse('x').success).toBe(false)
  })
})
