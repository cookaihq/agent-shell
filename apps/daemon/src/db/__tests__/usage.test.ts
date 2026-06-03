import { describe, it, expect } from 'vitest'
import { openDatabase } from '../database'
import { createProject } from '../projects'
import { createSession } from '../sessions'
import { recordUsage, getUsage, sumUsage } from '../usage'

describe('usage repo', () => {
  it('记录用量（带 cost）→ 查回', () => {
    const db = openDatabase(':memory:')
    recordUsage(db, { sessionId: 's1', turn: 1, inputTokens: 100, outputTokens: 20, costUsd: 0.012 })
    expect(getUsage(db, 's1')[0]).toMatchObject({ sessionId: 's1', turn: 1, inputTokens: 100, outputTokens: 20, costUsd: 0.012 })
    db.close()
  })

  it('cost 省略（codex）→ costUsd null', () => {
    const db = openDatabase(':memory:')
    recordUsage(db, { sessionId: 's1', turn: 1, inputTokens: 5, outputTokens: 5 })
    expect(getUsage(db, 's1')[0].costUsd).toBeNull()
    db.close()
  })

  it('多轮按插入顺序', () => {
    const db = openDatabase(':memory:')
    recordUsage(db, { sessionId: 's1', turn: 1, inputTokens: 1, outputTokens: 1 })
    recordUsage(db, { sessionId: 's1', turn: 2, inputTokens: 2, outputTokens: 2 })
    expect(getUsage(db, 's1').map((u) => u.turn)).toEqual([1, 2])
    db.close()
  })

  it('sumUsage 聚合会话总用量', () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: 'p', path: '/w' })
    const s = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus' })
    recordUsage(db, { sessionId: s.id, turn: 1, inputTokens: 10, outputTokens: 5, costUsd: 0.1 })
    recordUsage(db, { sessionId: s.id, turn: 2, inputTokens: 20, outputTokens: 7, costUsd: 0.2 })
    expect(sumUsage(db, s.id)).toEqual({ inputTokens: 30, outputTokens: 12, costUsd: 0.3 })
    db.close()
  })
})
