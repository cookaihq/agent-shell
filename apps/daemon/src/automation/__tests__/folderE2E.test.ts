import { describe, it, expect } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { openDatabase } from '../../db/database'
import { makeAutomationStore } from '../automationStore'
import { AutomationScheduler } from '../scheduler'

describe('folder automation E2E', () => {
  it('create → 文件夹落地 → scheduler 排期 → 改 enabled=false 取消排期', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e-'))
    const db = openDatabase(':memory:')
    const store = makeAutomationStore({ db, automationsDir: () => dir })
    let nowMs = Date.UTC(2026, 0, 1, 0, 0, 0)
    const timers: { cb: () => void; delay: number }[] = []
    const sched = new AutomationScheduler({ db, store, now: () => nowMs, setTimer: (cb, delay) => { const t = { cb, delay }; timers.push(t); return t }, clearTimer: () => {} })
    sched.setRunHandler(async () => {})

    const a = store.create({ name: '巡检', prompt: '跑脚本', engine: 'claude', model: 'opus', permission: 'bypassPermissions', category: [], tags: [], requires: [], triggers: [{ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }], executor: 'agent', target: { mode: 'create_each_run' }, enabled: true })
    sched.armAll()
    expect(store.get(a.id)!.nextRunAt).toBeGreaterThan(nowMs) // 排上了

    store.patch(a.id, { enabled: false })
    sched.reschedule(a.id)
    expect(store.get(a.id)!.nextRunAt).toBe(null) // 暂停清空

    // 文件确实在磁盘、frontmatter 可读回（含 triggers / executor 形态）
    const md = fs.readFileSync(path.join(dir, a.id, 'AUTOMATION.md'), 'utf8')
    expect(md).toContain('name: 巡检')
    expect(md).toContain('triggers:')   // 单数 schedule 已泛化为 triggers 列表
    expect(md).toContain('executor: agent')
    sched.stop(); db.close(); fs.rmSync(dir, { recursive: true, force: true })
  })

  it('startup + 时间档双触发 → 落地后读回两条触发器', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'e2e2-'))
    const db = openDatabase(':memory:')
    const store = makeAutomationStore({ db, automationsDir: () => dir })
    const a = store.create({ name: '开机巡检', prompt: '跑', engine: 'claude', model: 'opus', permission: 'bypassPermissions', category: ['运维'], tags: ['每日'], requires: [{ kind: 'env', name: 'TOKEN' }], triggers: [{ kind: 'startup' }, { kind: 'daily', time: '10:00', timezone: 'Asia/Shanghai' }], executor: 'agent', target: { mode: 'create_each_run' }, enabled: true })
    const got = store.get(a.id)!
    expect(got.triggers).toEqual([{ kind: 'startup' }, { kind: 'daily', time: '10:00', timezone: 'Asia/Shanghai' }])
    expect(got.category).toEqual(['运维'])
    expect(got.tags).toEqual(['每日'])
    expect(got.requires).toEqual([{ kind: 'env', name: 'TOKEN' }])
    db.close(); fs.rmSync(dir, { recursive: true, force: true })
  })
})
