/**
 * chatUIConfig.test.ts — 切片运行时档位描述符（spec §7）
 *
 * 验证 getRuntimeChips 的 text/risk 与重构前 chipPerm/chipEffort 输出一致（回归门禁）：
 *   - claude default → 询问 ask；bypassPermissions → 绕过 high；effort high → 高
 *   - codex on-request×workspace-write → 按需·工作区 mid；never×danger-full-access → 从不·完全 high；effort medium → 中
 * 以及 getModeSelector / getModelSection / getEffortSection 形状。
 */
import { describe, it, expect } from 'vitest'
import { getSlice } from '../registry'
import type { RuntimeSlots } from '../types'

const claude = getSlice('claude').chatUIConfig
const codex = getSlice('codex').chatUIConfig

const claudeSlots = (over: Partial<RuntimeSlots> = {}): RuntimeSlots =>
  ({ engine: 'claude', model: 'opus', reasoning: 'high', permissionMode: 'default', ...over })
const codexSlots = (over: Partial<RuntimeSlots> = {}): RuntimeSlots =>
  ({ engine: 'codex', model: 'gpt-5.5', reasoning: 'medium', permissionMode: 'default', modeSelections: { approval: 'on-request', sandbox: 'workspace-write' }, ...over })

describe('claude getRuntimeChips（对齐旧 chipPerm/chipEffort）', () => {
  it('default → perm 询问 ask + effort 高', () => {
    const chips = claude.getRuntimeChips(claudeSlots())
    expect(chips[0]).toMatchObject({ text: '询问', risk: 'ask' })
    expect(chips[1]).toMatchObject({ text: '高' })
    expect(chips[1].risk).toBeUndefined()   // effort chip 无 dot
  })

  it('bypassPermissions → 绕过 high', () => {
    const chips = claude.getRuntimeChips(claudeSlots({ permissionMode: 'bypassPermissions' }))
    expect(chips[0]).toMatchObject({ text: '绕过', risk: 'high' })
  })

  it('effort xhigh → 极高', () => {
    const chips = claude.getRuntimeChips(claudeSlots({ reasoning: 'xhigh' }))
    expect(chips[1].text).toBe('极高')
  })
})

describe('codex 模型 value = 真实 codex slug（传给 codex CLI -m，不是展示标签）', () => {
  it('value 用真实 slug（gpt-5.5 等），label 是友好名', () => {
    const opts = codex.getModelOptions(codexSlots())
    expect(opts).toContainEqual({ value: 'gpt-5.5', label: 'GPT 5.5' })
    expect(opts).toContainEqual({ value: 'gpt-5.4', label: 'GPT 5.4' })
    expect(opts).toContainEqual({ value: 'gpt-5.3-codex', label: 'GPT 5.3 Codex' })
    expect(opts).toContainEqual({ value: 'gpt-5.4-mini', label: 'GPT 5.4 Mini' })
  })

  it('所有 value 必须是 codex CLI 能接受的 slug 形态（小写、无空格）', () => {
    for (const o of codex.getModelOptions(codexSlots())) {
      expect(o.value).toMatch(/^[a-z0-9.-]+$/)   // 'GPT 5.5'（含空格大写）会失败
    }
  })

  it('getModelLabel(真实 slug) → 友好展示名', () => {
    expect(codex.getModelLabel('gpt-5.5')).toBe('GPT 5.5')
    expect(codex.getModelLabel('gpt-5.3-codex')).toBe('GPT 5.3 Codex')
  })
})

describe('codex getRuntimeChips（对齐旧 chipPerm/chipEffort）', () => {
  it('on-request × workspace-write → 按需·工作区 mid + effort 中', () => {
    const chips = codex.getRuntimeChips(codexSlots())
    expect(chips[0]).toMatchObject({ text: '按需·工作区', risk: 'mid' })
    expect(chips[1].text).toBe('中')
  })

  it('never × danger-full-access → 从不·完全 high', () => {
    const chips = codex.getRuntimeChips(codexSlots({ modeSelections: { approval: 'never', sandbox: 'danger-full-access' } }))
    expect(chips[0]).toMatchObject({ text: '从不·完全', risk: 'high' })
  })
})

describe('getModeSelector', () => {
  it('claude → 1 段权限（写 permissionMode 槽），5 档', () => {
    const segs = claude.getModeSelector(claudeSlots({ permissionMode: 'plan' }))
    expect(segs).toHaveLength(1)
    expect(segs[0].slot).toBe('permissionMode')
    expect(segs[0].current).toBe('plan')
    expect(segs[0].options).toHaveLength(5)
  })

  it('codex → 2 段（审批写 approval 槽 / 沙箱写 sandbox 槽）', () => {
    const segs = codex.getModeSelector(codexSlots({ modeSelections: { approval: 'never', sandbox: 'read-only' } }))
    expect(segs.map((s) => s.slot)).toEqual(['approval', 'sandbox'])
    expect(segs[0].current).toBe('never')
    expect(segs[1].current).toBe('read-only')
  })
})

describe('getEffortSection', () => {
  it('claude 5 档（含 xhigh/max）', () => {
    const eff = claude.getEffortSection!(claudeSlots())
    expect(eff!.options).toHaveLength(5)
    expect(eff!.options.map((o) => o.id)).toContain('max')
    expect(eff!.current?.id).toBe('high')
  })

  it('codex 5 档（含 minimal/xhigh）', () => {
    const eff = codex.getEffortSection!(codexSlots())
    expect(eff!.options.map((o) => o.id)).toEqual(['minimal', 'low', 'medium', 'high', 'xhigh'])
    expect(eff!.current?.id).toBe('medium')
  })
})

describe('getModelSection / getModelOptions', () => {
  it('claude 折叠态 + 对齐后列表（弹窗段）', () => {
    const sec = claude.getModelSection(claudeSlots({ model: 'opus[1m]' }), null)
    expect(sec.collapsed).toBe(true)
    expect(sec.current?.label).toBe('Opus 1M')
    // 对齐后 4 条（无裸 opus）
    expect(sec.list.map((m) => m.label)).toEqual(['Default (recommended)', 'Sonnet', 'Haiku', 'Opus 1M'])
  })

  it('claude getModelOptions 不对齐（含裸 opus，作状态成员校验源）', () => {
    const opts = claude.getModelOptions(claudeSlots(), null)
    expect(opts.map((m) => m.value)).toEqual(expect.arrayContaining(['opus', 'opus[1m]']))
  })

  it('codex 平铺态', () => {
    const sec = codex.getModelSection(codexSlots(), null)
    expect(sec.collapsed).toBe(false)
    expect(sec.list.map((m) => m.value)).toContain('gpt-5.5')   // 真实 slug
  })
})
