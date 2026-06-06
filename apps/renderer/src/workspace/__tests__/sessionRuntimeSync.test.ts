import { describe, it, expect } from 'vitest'
import { applySessionRuntime } from '../sessionRuntimeSync'
import type { SessionDTO } from '../../api/types'

function sess(over: Partial<SessionDTO> = {}): SessionDTO {
  return {
    id: 'a', projectId: 'p', engine: 'codex', model: 'gpt-5.5', title: 't', pinned: false,
    status: 'completed', resumableId: null, permissionMode: 'default', effort: 'medium', createdAt: 0, ...over,
  }
}

describe('applySessionRuntime', () => {
  const sessions = [sess({ id: 'a' }), sess({ id: 'b', engine: 'claude', model: 'opus' })]

  it('更新指定会话的 model/permissionMode/effort，其余会话引用不变', () => {
    const next = applySessionRuntime(sessions, 'a', { model: 'gpt-5.4', permissionMode: 'plan', effort: 'high' })
    expect(next.find((s) => s.id === 'a')).toMatchObject({ model: 'gpt-5.4', permissionMode: 'plan', effort: 'high' })
    expect(next.find((s) => s.id === 'b')).toBe(sessions[1]) // 其他会话同引用（未触碰）
  })

  it('sessionId 不存在 → 原样返回同引用列表', () => {
    expect(applySessionRuntime(sessions, 'zzz', { model: 'x', permissionMode: 'y', effort: 'z' })).toBe(sessions)
  })

  it('档位无变化 → 原样返回同引用（避免无谓重渲染）', () => {
    const next = applySessionRuntime(sessions, 'a', { model: 'gpt-5.5', permissionMode: 'default', effort: 'medium' })
    expect(next).toBe(sessions)
  })
})
