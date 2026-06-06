import { describe, it, expect } from 'vitest'
import os from 'node:os'
import fs from 'node:fs'
import path from 'node:path'
import { openDatabase } from '../../db/database'
import { createProject, getProject, listProjects } from '../../db/projects'
import { createAutomation, listRunsByAutomation, type CreateAutomationInput } from '../../db/automations'
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
  const fake = new FakeRuntime()
  const handler = makeAutomationRunHandler({
    db, runtime: fake as unknown as SessionRuntime, resolveProjectsDir: () => projectsDir,
  })
  return { db, fake, handler, projectsDir }
}
const input = (over: Partial<CreateAutomationInput> = {}): CreateAutomationInput => ({
  name: '晨报', prompt: '抓取竞品定价', engine: 'claude', model: 'opus', permission: 'bypassPermissions',
  categories: [], schedule: { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }, target: { mode: 'create_each_run' }, enabled: true,
  ...over,
})

describe('makeAutomationRunHandler', () => {
  it('guardrail 含禁反问', () => {
    expect(guardrail('X')).toContain('不要反问')
    expect(guardrail('X')).toContain('AskUserQuestion')
  })

  it('create_each_run：建项目+会话，submit 带护栏+权限档，跑完 succeeded', async () => {
    const { db, fake, handler } = setup()
    const a = createAutomation(db, input())
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

  it('reuse：在指定项目下建会话，不新建项目', async () => {
    const { db, fake, handler, projectsDir } = setup()
    const proj = createProject(db, { id: 'p-reuse', name: 'reuse', path: path.join(projectsDir, 'p-reuse') })
    const a = createAutomation(db, input({ target: { mode: 'reuse', projectId: proj.id } }))
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
    const { db, handler } = setup()
    const a = createAutomation(db, input({ target: { mode: 'reuse', projectId: 'gone' } }))
    await handler(a, 'scheduled')
    const runs = listRunsByAutomation(db, a.id)
    expect(runs[0].status).toBe('failed')
    expect(runs[0].sessionId).toBe(null)
    db.close()
  })

  it('AskUserQuestion → deny + needs-review', async () => {
    const { db, fake, handler } = setup()
    const a = createAutomation(db, input())
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
    const { db, fake, handler } = setup()
    const a = createAutomation(db, input({ permission: 'default' }))
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
    const { db, fake, handler } = setup()
    const a = createAutomation(db, input())
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
    const { db, fake, handler } = setup()
    const a = createAutomation(db, input({ engine: 'codex', model: 'gpt-5.4-codex', permission: 'danger-full-access' }))
    const p = handler(a, 'scheduled')
    const sid = fake.submitted[0].sessionId
    expect(fake.submitted[0].cfg).toEqual({ sandbox: 'danger-full-access' })
    fake.emit(sid, { type: 'turn_end', stopReason: 'end_turn' })
    await p
    db.close()
  })
})
