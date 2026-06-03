import { describe, it, expect } from 'vitest'
import { openDatabase } from '../database'
import { createProject, getProject } from '../projects'
import { createSession, getSession, getSessionsByProject, setResumableId, setSessionStatus } from '../sessions'
import { appendMessage, getMessages } from '../messages'
import { recordUsage, getUsage } from '../usage'

describe('持久化生命周期（项目 → 会话 → 消息/用量）', () => {
  it('建项目 → 项目内建会话 → 存消息+用量 → 查回；resume 指针 + 失败状态', () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { name: '种子路演稿', path: '~/AgentShell/projects/seed' })
    const s = createSession(db, { projectId: proj.id, engine: 'claude', model: 'opus', title: '初稿' })

    appendMessage(db, { sessionId: s.id, role: 'user', blocks: [{ type: 'text', text: '帮我跑测试' }] })
    appendMessage(db, { sessionId: s.id, role: 'assistant', blocks: [{ type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'pnpm test' } }] })
    recordUsage(db, { sessionId: s.id, turn: 1, inputTokens: 1200, outputTokens: 340, costUsd: 0.05 })

    expect(getSessionsByProject(db, proj.id).map((x) => x.id)).toEqual([s.id])
    expect(getProject(db, proj.id)?.path).toBe('~/AgentShell/projects/seed')
    expect(getMessages(db, s.id)).toHaveLength(2)
    expect(getUsage(db, s.id)).toHaveLength(1)

    setResumableId(db, s.id, 'claude-native-session-xyz')
    setSessionStatus(db, s.id, 'aborted')
    const reloaded = getSession(db, s.id)
    expect(reloaded).toMatchObject({ resumableId: 'claude-native-session-xyz', status: 'aborted', engine: 'claude' })
    db.close()
  })

  it('一个项目多会话可混用引擎；两项目数据互不串', () => {
    const db = openDatabase(':memory:')
    const p1 = createProject(db, { name: 'P1', path: '/p1' })
    const p2 = createProject(db, { name: 'P2', path: '/p2' })
    const c = createSession(db, { projectId: p1.id, engine: 'claude', model: 'opus' })
    const x = createSession(db, { projectId: p1.id, engine: 'codex', model: 'gpt-5.5' })
    createSession(db, { projectId: p2.id, engine: 'claude', model: 'opus' })
    appendMessage(db, { sessionId: c.id, role: 'user', blocks: [{ type: 'text', text: 'A' }] })

    expect(getSessionsByProject(db, p1.id).map((s) => s.engine).sort()).toEqual(['claude', 'codex'])
    expect(getSessionsByProject(db, p2.id)).toHaveLength(1)
    expect(getMessages(db, x.id)).toHaveLength(0)
    db.close()
  })
})
