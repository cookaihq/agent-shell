import { describe, it, expect } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../../db/database'
import { createProject, listProjects } from '../../db/projects'
import { listRunsByAutomation } from '../../db/automations'
import { makeAutomationStore, type CreateAutomationInput } from '../automationStore'
import { makeAutomationRunHandler, guardrail } from '../runHandler'
import type { AgentEvent } from '@agent-shell/contracts'
import type { SessionRuntime } from '../../session/sessionRuntime'

class FakeRuntime {
  subscribers = new Map<string, (ev: AgentEvent) => void>()
  submitted: Array<{ sessionId: string; text: string; cfg: unknown }> = []
  decisions: Array<{ sessionId: string; requestId: string; behavior: string }> = []
  subscribe(id: string, fn: (ev: AgentEvent) => void) { this.subscribers.set(id, fn); return () => this.subscribers.delete(id) }
  submit(id: string, text: string, _files: string[], cfg: unknown) { this.submitted.push({ sessionId: id, text, cfg }) }
  resolveDecision(id: string, requestId: string, d: { behavior: string }) { this.decisions.push({ sessionId: id, requestId, behavior: d.behavior }) }
  emit(id: string, ev: AgentEvent) { this.subscribers.get(id)?.(ev) }
}

function setup() {
  const db = openDatabase(':memory:')
  const projectsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-auto-'))
  const skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-skills-'))
  const automationsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-autos-'))
  const store = makeAutomationStore({ db, automationsDir: () => automationsDir })
  const fake = new FakeRuntime()
  const handler = makeAutomationRunHandler({
    db, runtime: fake as unknown as SessionRuntime, store,
    resolveProjectsDir: () => projectsDir,
    resolveSkillsDir: () => skillsDir,
    resolveAutomationsDir: () => automationsDir,
  })
  return { db, fake, handler, store, projectsDir, skillsDir, automationsDir }
}
const input = (over: Partial<CreateAutomationInput> = {}): CreateAutomationInput => ({
  name: '晨报', prompt: '抓取竞品定价', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
  category: [], tags: [], requires: [],
  triggers: [{ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }],
  executor: 'agent', target: { mode: 'create_each_run' }, enabled: true,
  ...over,
})

describe('makeAutomationRunHandler', () => {
  it('guardrail 含禁反问 + 告知只读 assets 路径', () => {
    expect(guardrail('X', 'mon')).toContain('不要反问')
    expect(guardrail('X', 'mon')).toContain('AskUserQuestion')
    expect(guardrail('X', 'mon')).toContain('automation-assets/mon/')
  })

  it('create_each_run：建项目+会话，submit 带护栏+权限档，跑完 succeeded', async () => {
    const { db, fake, handler, store } = setup()
    const a = store.create(input())
    const p = handler(a, 'scheduled')
    expect(fake.submitted).toHaveLength(1)
    const sid = fake.submitted[0].sessionId
    expect(fake.submitted[0].text).toContain('无人值守')
    expect(fake.submitted[0].text).toContain('抓取竞品定价')
    expect(fake.submitted[0].cfg).toEqual({ permissionMode: 'bypassPermissions' })
    expect(listProjects(db)).toHaveLength(1) // 新建了项目
    fake.emit(sid, { type: 'turn_end', stopReason: 'end_turn' })
    await p
    const runs = listRunsByAutomation(db, a.id)
    expect(runs[0].status).toBe('succeeded')
    expect(runs[0].sessionId).toBe(sid)
    db.close()
  })

  it('运行前把任务脚本软链进项目 automation-assets', async () => {
    const { db, fake, handler, store, automationsDir } = setup()
    const a = store.create(input())
    fs.writeFileSync(path.join(automationsDir, a.id, 'check.mjs'), 'console.log(1)')
    const p = handler(a, 'scheduled')
    const sid = fake.submitted[0].sessionId
    fake.emit(sid, { type: 'turn_end', stopReason: 'end_turn' })
    await p
    const proj = listProjects(db)[0]
    const linked = path.join(proj.path, 'automation-assets', a.id, 'check.mjs')
    expect(fs.existsSync(linked)).toBe(true)
    expect(fs.readFileSync(linked, 'utf8')).toBe('console.log(1)')
    db.close()
  })

  it('executor=script → spawn 子进程直跑，exit 0 记 succeeded、不建会话', async () => {
    const { db, fake, handler, store, automationsDir } = setup()
    const a = store.create(input({ executor: 'script', script: 'ok.mjs' }))
    fs.writeFileSync(path.join(automationsDir, a.id, 'ok.mjs'), "process.stdout.write('done'); process.exit(0)")
    await handler(a, 'scheduled')
    expect(fake.submitted).toHaveLength(0)  // script 不建会话、不喂引擎
    const run = listRunsByAutomation(db, a.id)[0]
    expect(run.status).toBe('succeeded')
    expect(run.sessionId).toBe(null)        // script 不建会话
    expect(run.summary).toContain('done')   // 捕获 stdout
    db.close()
  })

  it('executor=script → exit 非 0 记 failed，error 带 stderr', async () => {
    const { db, handler, store, automationsDir } = setup()
    const a = store.create(input({ executor: 'script', script: 'boom.mjs' }))
    fs.writeFileSync(path.join(automationsDir, a.id, 'boom.mjs'), "process.stderr.write('boom'); process.exit(1)")
    await handler(a, 'scheduled')
    const run = listRunsByAutomation(db, a.id)[0]
    expect(run.status).toBe('failed')
    expect(run.error).toContain('exit 1')
    expect(run.error).toContain('boom')
    db.close()
  })

  it('reuse：在指定项目下建会话，不新建项目', async () => {
    const { db, fake, handler, store, projectsDir } = setup()
    const proj = createProject(db, { id: 'p-reuse', name: 'reuse', path: path.join(projectsDir, 'p-reuse') })
    const a = store.create(input({ target: { mode: 'reuse', projectId: proj.id } }))
    const p = handler(a, 'manual')
    const sid = fake.submitted[0].sessionId
    fake.emit(sid, { type: 'turn_end', stopReason: 'end_turn' })
    await p
    expect(listProjects(db)).toHaveLength(1) // 没新建
    const runs = listRunsByAutomation(db, a.id)
    expect(runs[0].projectId).toBe(proj.id)
    db.close()
  })

  it('reuse 项目已删 → 直接 failed run，无会话', async () => {
    const { db, handler, store } = setup()
    const a = store.create(input({ target: { mode: 'reuse', projectId: 'gone' } }))
    await handler(a, 'scheduled')
    const runs = listRunsByAutomation(db, a.id)
    expect(runs[0].status).toBe('failed')
    expect(runs[0].sessionId).toBe(null)
    db.close()
  })

  it('AskUserQuestion → deny + needs-review', async () => {
    const { db, fake, handler, store } = setup()
    const a = store.create(input())
    const p = handler(a, 'scheduled')
    const sid = fake.submitted[0].sessionId
    fake.emit(sid, { type: 'ask_user_question', requestId: 'q1', questions: [] as never })
    fake.emit(sid, { type: 'turn_end', stopReason: 'end_turn' })
    await p
    expect(fake.decisions).toEqual([{ sessionId: sid, requestId: 'q1', behavior: 'deny' }])
    expect(listRunsByAutomation(db, a.id)[0].status).toBe('needs-review')
    db.close()
  })

  it('permission_request（超档）→ deny + needs-review', async () => {
    const { db, fake, handler, store } = setup()
    const a = store.create(input({ permission: 'default' }))
    const p = handler(a, 'scheduled')
    const sid = fake.submitted[0].sessionId
    fake.emit(sid, { type: 'permission_request', requestId: 'perm1', toolName: 'Bash', input: {} })
    fake.emit(sid, { type: 'turn_end', stopReason: 'end_turn' })
    await p
    expect(fake.decisions[0].behavior).toBe('deny')
    expect(listRunsByAutomation(db, a.id)[0].status).toBe('needs-review')
    db.close()
  })

  it('turn_end failed → failed + error=detail', async () => {
    const { db, fake, handler, store } = setup()
    const a = store.create(input())
    const p = handler(a, 'scheduled')
    const sid = fake.submitted[0].sessionId
    fake.emit(sid, { type: 'turn_end', stopReason: 'failed', detail: '上游 429' })
    await p
    const run = listRunsByAutomation(db, a.id)[0]
    expect(run.status).toBe('failed')
    expect(run.error).toBe('上游 429')
    db.close()
  })

  it('codex：submit cfg 走 sandbox', async () => {
    const { db, fake, handler, store } = setup()
    const a = store.create(input({ engine: 'codex', model: 'gpt-5.4-codex', permission: 'danger-full-access' }))
    const p = handler(a, 'scheduled')
    const sid = fake.submitted[0].sessionId
    expect(fake.submitted[0].cfg).toEqual({ sandbox: 'danger-full-access' })
    fake.emit(sid, { type: 'turn_end', stopReason: 'end_turn' })
    await p
    db.close()
  })
})
