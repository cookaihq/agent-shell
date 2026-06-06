import { describe, it, expect } from 'vitest'
import { applyVscodeAlignment, isOneM, type AlignModel } from '../modelAlignment'

describe('isOneM', () => {
  it('value 带 [1m] 后缀 → true', () => {
    expect(isOneM({ value: 'opus[1m]', displayName: 'Opus', description: '' })).toBe(true)
    expect(isOneM({ value: 'sonnet[1m]', displayName: 'Sonnet', description: '' })).toBe(true)
  })
  it('description 含 1M 文本 → true（SDK 只在描述标 1M 的兜底）', () => {
    expect(isOneM({ value: 'opus', displayName: 'Opus', description: 'Opus 4.8 · 1M context' })).toBe(true)
  })
  it('既无 [1m] 后缀也无 1M 描述 → false', () => {
    expect(isOneM({ value: 'opus', displayName: 'Opus', description: 'Most capable' })).toBe(false)
    expect(isOneM({ value: 'sonnet', displayName: 'Sonnet', description: 'Everyday' })).toBe(false)
  })
})

describe('applyVscodeAlignment', () => {
  const sdkRaw: AlignModel[] = [
    { value: 'default', displayName: 'Default (recommended)', description: 'Opus 4.8 · 1M context · Most capable for complex work' },
    { value: 'sonnet', displayName: 'Sonnet', description: 'Sonnet 4.6 · Best for everyday tasks' },
    { value: 'sonnet[1m]', displayName: 'Sonnet (1M context)', description: 'Sonnet 4.6 · 1M context' },
    { value: 'haiku', displayName: 'Haiku', description: 'Haiku 4.5 · Fastest for quick answers' },
    { value: 'opus', displayName: 'Opus', description: 'Opus 4.8 · Most capable for complex work' },
  ]

  it('丢非 1M opus 与 sonnet[1m]，补上 1M opus 条', () => {
    const out = applyVscodeAlignment(sdkRaw)
    const values = out.map((m) => m.value)
    expect(values).not.toContain('opus')
    expect(values).not.toContain('sonnet[1m]')
    expect(values).toContain('default')
    expect(values).toContain('sonnet')
    expect(values).toContain('haiku')
    expect(values).toContain('opus[1m]')
  })

  it('输出 4 条、顺序 Default→Sonnet→Haiku→Opus(1M)', () => {
    const out = applyVscodeAlignment(sdkRaw)
    expect(out.map((m) => m.displayName)).toEqual([
      'Default (recommended)',
      'Sonnet',
      'Haiku',
      'Opus 1M',
    ])
  })

  it('SDK 已直接给 opus[1m] 时直接用它当 1M opus（不再从 default 兜）', () => {
    const withOpus1m: AlignModel[] = [
      { value: 'default', displayName: 'Default (recommended)', description: '1M context' },
      { value: 'sonnet', displayName: 'Sonnet', description: 'Everyday' },
      { value: 'haiku', displayName: 'Haiku', description: 'Fast' },
      { value: 'opus[1m]', displayName: 'Opus 1M', description: 'Opus 4.8 · 1M context' },
    ]
    const out = applyVscodeAlignment(withOpus1m)
    const opus = out.find((m) => m.displayName === 'Opus 1M')
    expect(opus?.value).toBe('opus[1m]')
  })

  it('静态兜底形态（CLI_MODELS.claude 映射）也对齐成 4 条', () => {
    const staticRaw: AlignModel[] = [
      { value: 'default', displayName: 'Default (recommended)', description: '' },
      { value: 'sonnet', displayName: 'Sonnet', description: '' },
      { value: 'haiku', displayName: 'Haiku', description: '' },
      { value: 'opus', displayName: 'Opus', description: '' },
      { value: 'opus[1m]', displayName: 'Opus 1M', description: '' },
    ]
    const out = applyVscodeAlignment(staticRaw)
    expect(out.map((m) => m.value)).toEqual(['default', 'sonnet', 'haiku', 'opus[1m]'])
    expect(out.some((m) => m.value === 'opus')).toBe(false)
  })

  it('空输入 → 空数组（不抛、不造假条）', () => {
    expect(applyVscodeAlignment([])).toEqual([])
  })
})
