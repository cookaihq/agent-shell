import { describe, it, expect } from 'vitest'
import { openDatabase } from '../database'
import Database from 'better-sqlite3'
import { initSchema } from '../schema'
import { createSession, getSession, getSessionsByProject, setResumableId, setSessionStatus, setSessionPinned, setSessionTitle, setSessionRuntime, setSessionVersions, deleteSession } from '../sessions'
import { recordUsage } from '../usage'

describe('sessions repo', () => {
  it('建会话挂 project_id → 查回（默认 title/pinned false/status idle/resumableId null）', () => {
    const db = openDatabase(':memory:')
    const s = createSession(db, { projectId: 'p1', engine: 'claude', model: 'opus' })
    expect(s.id).toMatch(/[0-9a-f-]{36}/)
    expect(s).toMatchObject({ projectId: 'p1', engine: 'claude', model: 'opus', title: '新会话', pinned: false, status: 'idle', resumableId: null })
    expect(getSession(db, s.id)).toMatchObject({ projectId: 'p1', engine: 'claude', pinned: false, status: 'idle' })
    db.close()
  })

  it('自定义 title；engine 每会话可不同', () => {
    const db = openDatabase(':memory:')
    const a = createSession(db, { projectId: 'p1', engine: 'claude', model: 'opus', title: '改 bug' })
    const b = createSession(db, { projectId: 'p1', engine: 'codex', model: 'gpt-5.5' })
    expect(a.title).toBe('改 bug')
    expect(getSession(db, b.id)?.engine).toBe('codex')
    db.close()
  })

  it('setResumableId / setSessionStatus 写回', () => {
    const db = openDatabase(':memory:')
    const s = createSession(db, { projectId: 'p1', engine: 'codex', model: 'gpt-5.5' })
    setResumableId(db, s.id, 'engine-sess-abc')
    setSessionStatus(db, s.id, 'failed')
    expect(getSession(db, s.id)).toMatchObject({ resumableId: 'engine-sess-abc', status: 'failed' })
    db.close()
  })

  it('getSessionsByProject 只返回该项目的会话，最近在前', () => {
    const db = openDatabase(':memory:')
    const a = createSession(db, { projectId: 'p1', engine: 'claude', model: 'opus' })
    createSession(db, { projectId: 'p2', engine: 'claude', model: 'opus' })
    const b = createSession(db, { projectId: 'p1', engine: 'codex', model: 'gpt-5.5' })
    expect(getSessionsByProject(db, 'p1').map((s) => s.id)).toEqual([b.id, a.id])
    db.close()
  })

  it('查不存在 → undefined', () => {
    const db = openDatabase(':memory:')
    expect(getSession(db, 'nope')).toBeUndefined()
    db.close()
  })

  it('setSessionPinned / setSessionTitle 更新列', () => {
    const db = openDatabase(':memory:')
    const proj = { id: 'p1' }
    const s = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    setSessionPinned(db, s.id, true); setSessionTitle(db, s.id, '新名')
    const r = getSession(db, s.id)!
    expect(r.pinned).toBe(true); expect(r.title).toBe('新名')
    db.close()
  })

  it('运行时档位（Issue 13/29）：createSession 带 permissionMode/effort 写入；缺省为 null', () => {
    const db = openDatabase(':memory:')
    const a = createSession(db, { projectId: 'p1', engine: 'claude', model: 'opus', permissionMode: 'plan', effort: 'max' })
    expect(getSession(db, a.id)).toMatchObject({ permissionMode: 'plan', effort: 'max' })
    const b = createSession(db, { projectId: 'p1', engine: 'claude', model: 'opus' })
    expect(getSession(db, b.id)).toMatchObject({ permissionMode: null, effort: null })
    db.close()
  })

  it('setSessionRuntime 只更新传入字段，重开回填', () => {
    const db = openDatabase(':memory:')
    const s = createSession(db, { projectId: 'p1', engine: 'claude', model: 'opus' })
    setSessionRuntime(db, s.id, { permissionMode: 'acceptEdits' })
    expect(getSession(db, s.id)).toMatchObject({ permissionMode: 'acceptEdits', effort: null })
    setSessionRuntime(db, s.id, { effort: 'high' })
    expect(getSession(db, s.id)).toMatchObject({ permissionMode: 'acceptEdits', effort: 'high' })
    // 模型切换落库（选模型生效）：重开会话回填新模型
    setSessionRuntime(db, s.id, { model: 'opus[1m]' })
    expect(getSession(db, s.id)).toMatchObject({ model: 'opus[1m]', permissionMode: 'acceptEdits', effort: 'high' })
    db.close()
  })

  it('codex 两轴权限（Part A P3）：createSession 带 sandbox/approval 写入并读回；缺省为 null', () => {
    const db = openDatabase(':memory:')
    const a = createSession(db, { projectId: 'p1', engine: 'codex', model: 'gpt-5.5', sandbox: 'danger-full-access', approval: 'never' })
    expect(getSession(db, a.id)).toMatchObject({ sandbox: 'danger-full-access', approval: 'never' })
    const b = createSession(db, { projectId: 'p1', engine: 'codex', model: 'gpt-5.5' })
    expect(getSession(db, b.id)).toMatchObject({ sandbox: null, approval: null })
    db.close()
  })

  it('setSessionRuntime 持久化 codex sandbox/approval，重开回填（Part A P3）', () => {
    const db = openDatabase(':memory:')
    const s = createSession(db, { projectId: 'p1', engine: 'codex', model: 'gpt-5.5' })
    setSessionRuntime(db, s.id, { sandbox: 'workspace-write' })
    expect(getSession(db, s.id)).toMatchObject({ sandbox: 'workspace-write', approval: null })
    setSessionRuntime(db, s.id, { approval: 'on-request' })
    expect(getSession(db, s.id)).toMatchObject({ sandbox: 'workspace-write', approval: 'on-request' })
    db.close()
  })

  it('setSessionVersions 写入 + getSession 读回版本', () => {
    const db = openDatabase(':memory:')
    const s = createSession(db, { projectId: 'p1', engine: 'claude', model: 'opus' })
    setSessionVersions(db, s.id, { claudeCodeVersion: '2.1.161', sdkVersion: '0.3.161' })
    const got = getSession(db, s.id)!
    expect(got.claudeCodeVersion).toBe('2.1.161')
    expect(got.sdkVersion).toBe('0.3.161')
    db.close()
  })

  it('迁移（Issue 13/29）：老库（无 permission_mode/effort 列）initSchema 幂等补列', () => {
    const db = new Database(':memory:')
    // 模拟旧 schema：sessions 表无新列
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, engine TEXT NOT NULL, model TEXT NOT NULL, title TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'idle', resumable_id TEXT, created_at INTEGER NOT NULL)`)
    db.prepare('INSERT INTO sessions (id, project_id, engine, model, title, created_at) VALUES (?,?,?,?,?,?)').run('old1', 'p1', 'claude', 'opus', '旧会话', 1)
    initSchema(db)  // 应 ALTER 补列，不报错、不丢数据
    const cols = (db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('permission_mode')
    expect(cols).toContain('effort')
    expect(getSession(db, 'old1')).toMatchObject({ id: 'old1', permissionMode: null, effort: null })
    db.close()
  })

  it('codex 两轴权限列（Part A P1）：新建库 sessions 表含 codex_sandbox/codex_approval', () => {
    const db = openDatabase(':memory:')
    const cols = (db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('codex_sandbox')
    expect(cols).toContain('codex_approval')
    db.close()
  })

  it('迁移（Part A P1）：老库（无 codex 列）initSchema 幂等补 codex_sandbox/codex_approval', () => {
    const db = new Database(':memory:')
    db.exec(`CREATE TABLE sessions (id TEXT PRIMARY KEY, project_id TEXT NOT NULL, engine TEXT NOT NULL, model TEXT NOT NULL, title TEXT NOT NULL, pinned INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'idle', resumable_id TEXT, created_at INTEGER NOT NULL)`)
    initSchema(db)
    const cols = (db.prepare('PRAGMA table_info(sessions)').all() as { name: string }[]).map((c) => c.name)
    expect(cols).toContain('codex_sandbox')
    expect(cols).toContain('codex_approval')
    db.close()
  })

  it('deleteSession 级联删会话 + 它的 usage；删别的会话不受影响；不存在 → false', () => {
    const db = openDatabase(':memory:')
    const a = createSession(db, { projectId: 'p1', engine: 'claude', model: 'opus' })
    const b = createSession(db, { projectId: 'p1', engine: 'claude', model: 'opus' })
    recordUsage(db, { sessionId: a.id, turn: 1, inputTokens: 10, outputTokens: 5, costUsd: 0.01 })
    expect(deleteSession(db, a.id)).toBe(true)
    expect(getSession(db, a.id)).toBeUndefined()
    expect((db.prepare('SELECT COUNT(*) AS c FROM usage WHERE session_id = ?').get(a.id) as { c: number }).c).toBe(0)
    expect(getSession(db, b.id)).toBeDefined()   // 删 a 不动 b
    expect(deleteSession(db, 'nope')).toBe(false)
    db.close()
  })
})
