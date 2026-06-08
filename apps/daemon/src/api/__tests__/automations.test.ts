import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'
import { insertRun, updateRun } from '../../db/automations'
import { makeAutomationStore, type CreateAutomationInput } from '../../automation/automationStore'
import { createProject } from '../../db/projects'
import { createSession } from '../../db/sessions'
import type { AutomationScheduler } from '../../automation/scheduler'

let server: DaemonServer | null = null
let tmp: string
let autoDir: string
afterEach(async () => {
  if (server) await server.close(); server = null
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  if (autoDir) fs.rmSync(autoDir, { recursive: true, force: true })
})

class FakeScheduler {
  calls: Array<{ fn: string; id?: string }> = []
  setRunHandler() {}
  armAll() {}
  reschedule(id: string) { this.calls.push({ fn: 'reschedule', id }) }
  cancel(id: string) { this.calls.push({ fn: 'cancel', id }) }
  runNow(id: string) { this.calls.push({ fn: 'runNow', id }); return Promise.resolve() }
  stop() {}
}

// 测试用 store 与 daemon 内部 store 共享同一 db + 同一 autoDir（隔离临时目录），故 store.create 落地后 API 可见。
function start(db = openDatabase(':memory:')) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-auto-route-'))
  autoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-auto-lib-'))
  const store = makeAutomationStore({ db, automationsDir: () => autoDir })
  const scheduler = new FakeScheduler()
  return { scheduler, db, store, promise: startDaemon({ detect: () => ({ claude: '/x/claude', codex: '/x/codex' }), db, projectsDir: tmp, automationsDir: autoDir, scheduler: scheduler as unknown as AutomationScheduler }) }
}
// HTTP 请求体（CreateAutomationReq 形态：category/tags/requires/executor 有默认，可省）
const body = (over: Record<string, unknown> = {}) => ({
  name: '晨报', prompt: '抓取竞品', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
  triggers: [{ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }], target: { mode: 'create_each_run' },
  ...over,
})
// store.create 入参（CreateAutomationInput 形态：全字段）
const seedInput = (over: Partial<CreateAutomationInput> = {}): CreateAutomationInput => ({
  name: '晨报', prompt: '抓取竞品', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
  category: [], tags: [], requires: [],
  triggers: [{ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }], executor: 'agent',
  target: { mode: 'create_each_run' }, enabled: true,
  ...over,
})
const JSON_H = { 'content-type': 'application/json' }

describe('POST /automations', () => {
  it('201 + 重排调度', async () => {
    const { scheduler, promise } = start(); server = await promise
    const res = await fetch(server.url + '/automations', { method: 'POST', headers: JSON_H, body: JSON.stringify(body()) })
    expect(res.status).toBe(201)
    const j = await res.json() as { automationId: string }
    expect(j.automationId).toBeTruthy()
    expect(scheduler.calls).toEqual([{ fn: 'reschedule', id: j.automationId }])
  })
  it('权限档与引擎不匹配 → 400', async () => {
    const { promise } = start(); server = await promise
    const res = await fetch(server.url + '/automations', { method: 'POST', headers: JSON_H, body: JSON.stringify(body({ engine: 'claude', permission: 'workspace-write' })) })
    expect(res.status).toBe(400)
  })
  it('codex 沙箱档放行', async () => {
    const { promise } = start(); server = await promise
    const res = await fetch(server.url + '/automations', { method: 'POST', headers: JSON_H, body: JSON.stringify(body({ engine: 'codex', model: 'gpt-5.4-codex', permission: 'danger-full-access' })) })
    expect(res.status).toBe(201)
  })
})

describe('GET /automations', () => {
  it('列表带 lastRun', async () => {
    const db = openDatabase(':memory:')
    const { store, promise } = start(db); server = await promise
    store.create(seedInput())
    const res = await fetch(server.url + '/automations')
    const j = await res.json() as { automations: Array<{ name: string; lastRun: unknown }> }
    expect(j.automations).toHaveLength(1)
    expect(j.automations[0].name).toBe('晨报')
    expect(j.automations[0].lastRun).toBe(null)
  })
})

describe('PATCH /automations/:id', () => {
  it('改 enabled → 重排；404 不存在', async () => {
    const db = openDatabase(':memory:')
    const { scheduler, store, promise } = start(db); server = await promise
    const a = store.create(seedInput())
    const res = await fetch(server.url + '/automations/' + a.id, { method: 'PATCH', headers: JSON_H, body: JSON.stringify({ enabled: false }) })
    expect(res.status).toBe(200)
    expect(scheduler.calls).toContainEqual({ fn: 'reschedule', id: a.id })
    const miss = await fetch(server.url + '/automations/nope', { method: 'PATCH', headers: JSON_H, body: JSON.stringify({ enabled: false }) })
    expect(miss.status).toBe(404)
  })
})

describe('DELETE /automations/:id', () => {
  it('取消调度 + 删除', async () => {
    const db = openDatabase(':memory:')
    const { scheduler, store, promise } = start(db); server = await promise
    const a = store.create(seedInput())
    const res = await fetch(server.url + '/automations/' + a.id, { method: 'DELETE' })
    expect(res.status).toBe(200)
    expect(scheduler.calls).toContainEqual({ fn: 'cancel', id: a.id })
  })
})

describe('GET /projects/:id/sessions 来源派生', () => {
  it('被 run 引用的会话 origin=automation 带名/摘要，其余 manual', async () => {
    const db = openDatabase(':memory:')
    const { store, promise } = start(db); server = await promise
    const proj = createProject(db, { id: 'p1', name: 'P', path: tmp })
    const sAuto = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus', title: '自动产出' })
    const sManual = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus', title: '手动开' })
    const a = store.create(seedInput({ triggers: [{ kind: 'weekly', time: '10:00', timezone: 'Asia/Shanghai', weekday: 1 }] }))
    const run = insertRun(db, { automationId: a.id, trigger: 'scheduled', status: 'running', projectId: proj.id, startedAt: 1 })
    updateRun(db, run.id, { sessionId: sAuto.id })
    const j = await (await fetch(server.url + '/projects/p1/sessions')).json() as { sessions: Array<{ id: string; origin: string; automationName?: string; scheduleSummary?: string }> }
    const auto = j.sessions.find((s) => s.id === sAuto.id)!
    const manual = j.sessions.find((s) => s.id === sManual.id)!
    expect(auto.origin).toBe('automation')
    expect(auto.automationName).toBe('晨报')
    expect(auto.scheduleSummary).toBe('每周一 10:00 · 上海')
    expect(manual.origin).toBe('manual')
  })
})

describe('POST /automations/:id/run + GET runs', () => {
  it('手动跑 202 + runNow；runs 列表', async () => {
    const db = openDatabase(':memory:')
    const { scheduler, store, promise } = start(db); server = await promise
    const a = store.create(seedInput())
    const res = await fetch(server.url + '/automations/' + a.id + '/run', { method: 'POST' })
    expect(res.status).toBe(202)
    expect(scheduler.calls).toContainEqual({ fn: 'runNow', id: a.id })
    const runs = await (await fetch(server.url + '/automations/' + a.id + '/runs')).json() as { runs: unknown[] }
    expect(Array.isArray(runs.runs)).toBe(true)
  })
})
