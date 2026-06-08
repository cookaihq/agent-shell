import { describe, it, expect } from 'vitest'
import { claudeChatUIConfig } from '../claude/chatUIConfig'
import { codexChatUIConfig } from '../codex/chatUIConfig'
import type { RuntimeSlots } from '../types'

const slots = (engine: 'claude' | 'codex'): RuntimeSlots => ({ engine, model: '', reasoning: '', permissionMode: '' })
const PM = [{ value: 'relay-opus', label: 'Relay Opus' }, { value: 'relay-mini', label: 'Relay Mini' }]

describe('getModelOptions providerModels 优先', () => {
  it('claude：providerModels 有 → 用它（盖过 dyn 与静态）', () => {
    const dyn = [{ value: 'opus', label: 'Opus' }]
    expect(claudeChatUIConfig.getModelOptions(slots('claude'), dyn, PM)).toEqual(PM)
  })
  it('claude：无 providerModels → 回落 dyn', () => {
    const dyn = [{ value: 'opus', label: 'Opus' }]
    expect(claudeChatUIConfig.getModelOptions(slots('claude'), dyn, [])).toEqual(dyn)
  })
  it('claude：无 providerModels 无 dyn → 静态表', () => {
    const r = claudeChatUIConfig.getModelOptions(slots('claude'), null, [])
    expect(r.some((m) => m.value === 'opus[1m]')).toBe(true)
  })
  it('codex：providerModels 有 → 用它', () => {
    expect(codexChatUIConfig.getModelOptions(slots('codex'), null, PM)).toEqual(PM)
  })
  it('codex：无 providerModels → 静态表', () => {
    const r = codexChatUIConfig.getModelOptions(slots('codex'), null, [])
    expect(r.some((m) => m.value === 'gpt-5.5')).toBe(true)
  })
})
