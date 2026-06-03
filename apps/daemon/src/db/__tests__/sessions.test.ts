import { describe, it, expect } from 'vitest'
import { openDatabase } from '../database'
import { createSession, getSession, getSessionsByProject, setResumableId, setSessionStatus, setSessionPinned, setSessionTitle } from '../sessions'

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
})
