import { describe, it, expect } from 'vitest'
import { resolveModelDisplay } from '../modelDisplay'
describe('resolveModelDisplay', () => {
  it('官方别名（modelAliases）优先', () => {
    expect(resolveModelDisplay('claude', 'claude-opus-4-8', { officialLabel: 'Opus', modelAliases: { claude: { 'claude-opus-4-8': '主力' } } }))
      .toEqual({ name: '主力', id: 'claude-opus-4-8', showId: true })
  })
  it('自定义 providerLabel 优先（无 modelAliases）', () => {
    expect(resolveModelDisplay('codex', 'gpt-5.5', { providerLabel: '快模型' })).toEqual({ name: '快模型', id: 'gpt-5.5', showId: true })
  })
  it('无别名 → 回落官方 label（label≠value → 显副行）', () => {
    expect(resolveModelDisplay('claude', 'opus', { officialLabel: 'Opus' })).toEqual({ name: 'Opus', id: 'opus', showId: true })
  })
  it('无任何名 → value 主、不显副行', () => {
    expect(resolveModelDisplay('codex', 'gpt-5.5', {})).toEqual({ name: 'gpt-5.5', id: 'gpt-5.5', showId: false })
  })
})
