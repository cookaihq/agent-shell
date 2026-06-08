import { describe, it, expect } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { openDatabase } from '../../db/database'
import { makeAutomationStore, type CreateAutomationInput } from '../automationStore'
import { AutomationScheduler } from '../scheduler'

interface FakeTimer { cb: () => void; delay: number; cleared: boolean }
function harness(nowStart: number) {
  const db = openDatabase(':memory:')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'))
  const store = makeAutomationStore({ db, automationsDir: () => dir })
  let nowMs = nowStart
  const timers: FakeTimer[] = []
  const setTimer = (cb: () => void, delay: number) => { const t: FakeTimer = { cb, delay, cleared: false }; timers.push(t); return t }
  const clearTimer = (h: unknown) => { (h as FakeTimer).cleared = true }
  const sched = new AutomationScheduler({ db, store, now: () => nowMs, setTimer, clearTimer })
  return { db, store, sched, timers, setNow: (ms: number) => { nowMs = ms }, now: () => nowMs, cleanup: () => { db.close(); fs.rmSync(dir, { recursive: true, force: true }) } }
}
const input = (over: Partial<CreateAutomationInput> = {}): CreateAutomationInput => ({
  name: 'n', prompt: 'p', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
  category: [], tags: [], requires: [],
  triggers: [{ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }],
  target: { mode: 'create_each_run' }, enabled: true, ...over,
})

describe('AutomationScheduler', () => {
  it('armAll 给启用项写 nextRunAt、跳过暂停项', () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    const on = h.store.create(input({ name: 'on' }))
    const off = h.store.create(input({ name: 'off', enabled: false }))
    h.sched.setRunHandler(async () => {})
    h.sched.armAll()
    expect(h.store.get(on.id)!.nextRunAt).toBe(Date.UTC(2026, 0, 1, 1, 0, 0))
    expect(h.store.get(off.id)!.nextRunAt).toBe(null)
    h.sched.stop()
    h.cleanup()
  })

  it('到点触发 runHandler 一次并重排下一次', async () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    const calls: string[] = []
    h.sched.setRunHandler(async (a, trigger) => { calls.push(`${a.name}:${trigger}`) })
    const a = h.store.create(input())
    h.sched.armAll()
    const fireAt = h.store.get(a.id)!.nextRunAt!
    const t = h.timers[0]
    expect(t.delay).toBe(fireAt - Date.UTC(2026, 0, 1, 0, 0, 0))
    // 到点
    h.setNow(fireAt)
    t.cb()
    await Promise.resolve(); await Promise.resolve()
    expect(calls).toEqual(['n:scheduled'])
    // 重排：新 timer 出现，nextRunAt 前进到次日
    expect(h.store.get(a.id)!.nextRunAt).toBe(Date.UTC(2026, 0, 2, 1, 0, 0))
    expect(h.timers.length).toBe(2)
    h.sched.stop()
    h.cleanup()
  })

  it('cap 中间唤醒（未真到点）→ 仅重排不触发', async () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    const calls: string[] = []
    h.sched.setRunHandler(async () => { calls.push('run') })
    const a = h.store.create(input())
    h.sched.armAll()
    const t = h.timers[0]
    // now 仍早于 fireAt → onFire 应判定未到点
    t.cb()
    await Promise.resolve()
    expect(calls).toEqual([])
    expect(h.timers.length).toBe(2) // 重排了
    void a
    h.sched.stop(); h.cleanup()
  })

  it('inflight 去重：手动与触发撞一起只跑一份', async () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    let resolveRun!: () => void
    let count = 0
    h.sched.setRunHandler(() => { count++; return new Promise<void>((res) => { resolveRun = res }) })
    const a = h.store.create(input())
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
    h.sched.stop(); h.cleanup()
  })

  it('reschedule 在 enabled=false 时取消并清 nextRunAt', () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    h.sched.setRunHandler(async () => {})
    const a = h.store.create(input())
    h.sched.armAll()
    expect(h.timers[0].cleared).toBe(false)
    h.store.patch(a.id, { enabled: false })
    h.sched.reschedule(a.id)
    expect(h.timers[0].cleared).toBe(true)
    expect(h.store.get(a.id)!.nextRunAt).toBe(null)
    h.sched.stop(); h.cleanup()
  })

  it('cancel 清定时器与 nextRunAt', () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    h.sched.setRunHandler(async () => {})
    const a = h.store.create(input())
    h.sched.armAll()
    h.sched.cancel(a.id)
    expect(h.timers[0].cleared).toBe(true)
    expect(h.store.get(a.id)!.nextRunAt).toBe(null)
    h.sched.stop(); h.cleanup()
  })

  it('一个任务两个时间触发器 → 两个 timer，next_run_at = 较早者', () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    const a = h.store.create(input({
      name: 'multi', triggers: [
        { kind: 'daily', time: '09:00', timezone: 'UTC' },
        { kind: 'daily', time: '06:00', timezone: 'UTC' },
      ],
    }))
    h.sched.setRunHandler(async () => {})
    h.sched.armAll()
    // 两条时间触发器 → 两个未清除 timer
    expect(h.timers.filter((t) => !t.cleared).length).toBe(2)
    // next_run_at 取较早（06:00 < 09:00）
    expect(h.store.get(a.id)!.nextRunAt).toBe(Date.UTC(2026, 0, 1, 6, 0, 0))
    h.sched.stop(); h.cleanup()
  })

  it('startup 触发器 → armAll 立即触发一次；同进程再 armAll 不重复', async () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    let runs = 0
    h.sched.setRunHandler(async () => { runs++ })
    h.store.create(input({ name: 'boot', triggers: [{ kind: 'startup' }] }))
    h.sched.armAll()
    await Promise.resolve() // 放行 microtask
    expect(runs).toBe(1)
    h.sched.armAll()          // 同进程二次 armAll
    await Promise.resolve()
    expect(runs).toBe(1)      // 节流：未重复触发
    h.sched.stop(); h.cleanup()
  })

  it('startup + 时间档混合 → armAll 不抛 + 时间档仍排上', () => {
    const h = harness(Date.UTC(2026, 0, 1, 0, 0, 0))
    h.sched.setRunHandler(async () => {})
    const a = h.store.create(input({ name: 'mix', triggers: [{ kind: 'startup' }, { kind: 'daily', time: '09:00', timezone: 'UTC' }] }))
    expect(() => h.sched.armAll()).not.toThrow()
    expect(h.store.get(a.id)!.nextRunAt).toBe(Date.UTC(2026, 0, 1, 9, 0, 0))
    h.sched.stop(); h.cleanup()
  })
})
