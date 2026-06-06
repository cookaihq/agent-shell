import { describe, it, expect, vi } from 'vitest'
import { openDatabase } from '../../db/database'
import { createAutomation, getAutomation, patchAutomation, type CreateAutomationInput } from '../../db/automations'
import { AutomationScheduler } from '../scheduler'
import type { AutomationSchedule } from '@agent-shell/contracts'

interface FakeTimer { cb: () => void; delay: number; cleared: boolean }
function harness(nowStart: number) {
  const db = openDatabase(':memory:')
  let nowMs = nowStart
  const timers: FakeTimer[] = []
  const setTimer = (cb: () => void, delay: number) => { const t: FakeTimer = { cb, delay, cleared: false }; timers.push(t); return t }
  const clearTimer = (h: unknown) => { (h as FakeTimer).cleared = true }
  const sched = new AutomationScheduler({ db, now: () => nowMs, setTimer, clearTimer })
  return { db, sched, timers, setNow: (ms: number) => { nowMs = ms }, now: () => nowMs }
}
const input = (over: Partial<CreateAutomationInput> = {}): CreateAutomationInput => ({
  name: 'n', prompt: 'p', engine: 'claude', model: 'opus', permission: 'bypassPermissions', categories: [],
  schedule: { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' } as AutomationSchedule,
  target: { mode: 'create_each_run' }, enabled: true, ...over,
})

describe('AutomationScheduler', () => {
  it('armAll 给启用项写 nextRunAt、跳过暂停项', () => {
    const { db, sched } = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    const on = createAutomation(db, input({ name: 'on' }))
    const off = createAutomation(db, input({ name: 'off', enabled: false }))
    sched.setRunHandler(async () => {})
    sched.armAll()
    expect(getAutomation(db, on.id)!.nextRunAt).toBe(Date.UTC(2026, 0, 1, 1, 0, 0))
    expect(getAutomation(db, off.id)!.nextRunAt).toBe(null)
    sched.stop()
    db.close()
  })

  it('到点触发 runHandler 一次并重排下一次', async () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    const calls: string[] = []
    h.sched.setRunHandler(async (a, trigger) => { calls.push(`${a.name}:${trigger}`) })
    const a = createAutomation(h.db, input())
    h.sched.armAll()
    const fireAt = getAutomation(h.db, a.id)!.nextRunAt!
    const t = h.timers[0]
    expect(t.delay).toBe(fireAt - Date.UTC(2026, 0, 1, 0, 0, 0))
    // 到点
    h.setNow(fireAt)
    t.cb()
    await Promise.resolve(); await Promise.resolve()
    expect(calls).toEqual(['n:scheduled'])
    // 重排：新 timer 出现，nextRunAt 前进到次日
    expect(getAutomation(h.db, a.id)!.nextRunAt).toBe(Date.UTC(2026, 0, 2, 1, 0, 0))
    expect(h.timers.length).toBe(2)
    h.sched.stop()
    h.db.close()
  })

  it('cap 中间唤醒（未真到点）→ 仅重排不触发', async () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    const calls: string[] = []
    h.sched.setRunHandler(async () => { calls.push('run') })
    const a = createAutomation(h.db, input())
    h.sched.armAll()
    const t = h.timers[0]
    // now 仍早于 fireAt → onFire 应判定未到点
    t.cb()
    await Promise.resolve()
    expect(calls).toEqual([])
    expect(h.timers.length).toBe(2) // 重排了
    void a
    h.sched.stop(); h.db.close()
  })

  it('inflight 去重：手动与触发撞一起只跑一份', async () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    let resolveRun!: () => void
    let count = 0
    h.sched.setRunHandler(() => { count++; return new Promise<void>((res) => { resolveRun = res }) })
    const a = createAutomation(h.db, input())
    const p1 = h.sched.runNow(a.id)
    const p2 = h.sched.runNow(a.id)
    expect(count).toBe(1)
    expect(p1).toBe(p2)
    resolveRun()
    await p1
    // 完成后 inflight 清空，可再跑
    const p3 = h.sched.runNow(a.id)
    expect(count).toBe(2)
    resolveRun()
    await p3
    h.sched.stop(); h.db.close()
  })

  it('reschedule 在 enabled=false 时取消并清 nextRunAt', () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    h.sched.setRunHandler(async () => {})
    const a = createAutomation(h.db, input())
    h.sched.armAll()
    expect(h.timers[0].cleared).toBe(false)
    patchAutomation(h.db, a.id, { enabled: false })
    h.sched.reschedule(a.id)
    expect(h.timers[0].cleared).toBe(true)
    expect(getAutomation(h.db, a.id)!.nextRunAt).toBe(null)
    h.sched.stop(); h.db.close()
  })

  it('cancel 清定时器与 nextRunAt', () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    h.sched.setRunHandler(async () => {})
    const a = createAutomation(h.db, input())
    h.sched.armAll()
    h.sched.cancel(a.id)
    expect(h.timers[0].cleared).toBe(true)
    expect(getAutomation(h.db, a.id)!.nextRunAt).toBe(null)
    h.sched.stop(); h.db.close()
  })
})
