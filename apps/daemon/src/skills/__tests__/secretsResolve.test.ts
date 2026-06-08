import { describe, it, expect } from 'vitest'
import { resolveSkillEnv } from '../secretsResolve'
import type { EntityRequirement } from '@agent-shell/contracts'

// 极简内存桩：只实现解析器用到的 get / getValue
const reqs = (m: Record<string, EntityRequirement>) => ({ get: (r: string) => m[r], all: () => m, put: () => {}, usageBySecret: () => ({}) })
const secrets = (m: Record<string, string>) => ({ getValue: (id: string) => m[id], view: () => [], create: () => ({} as never), update: () => null, remove: () => {} })

describe('resolveSkillEnv', () => {
  it('已绑定 env → 注入进 env map', () => {
    const r = resolveSkillEnv(
      reqs({ 'skill:a': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'K', bind: 'k1', optional: false }] } }),
      secrets({ k1: 'v1' }),
      ['skill:a'],
    )
    expect(r.env).toEqual({ K: 'v1' })
    expect(r.conflicts).toEqual([]); expect(r.missing).toEqual([])
  })
  it('必填未绑 → missing；optional 未绑 → 忽略', () => {
    const r = resolveSkillEnv(
      reqs({ 'skill:a': { needsConfig: true, slotsSource: 'manual', slots: [
        { kind: 'env', name: 'NEED', bind: null, optional: false },
        { kind: 'env', name: 'OPT', bind: null, optional: true },
      ] } }),
      secrets({}),
      ['skill:a'],
    )
    expect(r.env).toEqual({})
    expect(r.missing).toEqual([{ entityRef: 'skill:a', slot: 'NEED' }])
  })
  it('同名 env 绑同一 secret → 共用、不冲突', () => {
    const m = { kind: 'env' as const, name: 'K', bind: 'k1', optional: false }
    const r = resolveSkillEnv(
      reqs({ 'skill:a': { needsConfig: true, slotsSource: 'manual', slots: [m] }, 'skill:b': { needsConfig: true, slotsSource: 'manual', slots: [m] } }),
      secrets({ k1: 'v1' }),
      ['skill:a', 'skill:b'],
    )
    expect(r.env).toEqual({ K: 'v1' }); expect(r.conflicts).toEqual([])
  })
  it('同名 env 绑不同 secret → conflict（不写 env）', () => {
    const r = resolveSkillEnv(
      reqs({
        'skill:a': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'K', bind: 'k1', optional: false }] },
        'skill:b': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'K', bind: 'k2', optional: false }] },
      }),
      secrets({ k1: 'v1', k2: 'v2' }),
      ['skill:a', 'skill:b'],
    )
    expect(r.conflicts).toEqual([{ env: 'K', entityRefs: ['skill:a', 'skill:b'], secretIds: ['k1', 'k2'] }])
  })
  it('bind 指向已删除 secret → missing', () => {
    const r = resolveSkillEnv(
      reqs({ 'skill:a': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'K', bind: 'gone', optional: false }] } }),
      secrets({}),
      ['skill:a'],
    )
    expect(r.missing).toEqual([{ entityRef: 'skill:a', slot: 'K' }]); expect(r.env).toEqual({})
  })
  it('未精确探测（slots 缺省）→ 不注入、不报缺配（交 UI 处理 needsConfig）', () => {
    const r = resolveSkillEnv(
      reqs({ 'skill:a': { needsConfig: true, slotsSource: null } }),
      secrets({}),
      ['skill:a'],
    )
    expect(r.env).toEqual({}); expect(r.missing).toEqual([])
  })
  it('绑定到空值占位（getValue 返回空串）= 缺配，不写 env', () => {
    const reqs2 = { get: () => ({ needsConfig: true, slotsSource: 'manual' as const, slots: [{ kind: 'env' as const, name: 'X_API_KEY', bind: 'k_fox', optional: false, default: undefined }] }) }
    const secrets2 = { getValue: (id: string) => (id === 'k_fox' ? '' : undefined) }
    const out = resolveSkillEnv(reqs2 as any, secrets2 as any, ['skill:banana-2'])
    expect(out.env.X_API_KEY).toBeUndefined()
    expect(out.missing).toContainEqual({ entityRef: 'skill:banana-2', slot: 'X_API_KEY' })
  })
})
