import { describe, test, expect } from 'vitest'
import { buildRewindConfirmText, type RewindPreview } from '../rewind'

describe('buildRewindConfirmText', () => {
  test('canRewind:false + 有 error → 返回 error 文案，ok:false', () => {
    const r = buildRewindConfirmText({ canRewind: false, error: '会话已结束，无法回退' })
    expect(r.ok).toBe(false)
    expect(r.text).toBe('会话已结束，无法回退')
  })

  test('canRewind:false + 无 error → 返回兜底文案，ok:false', () => {
    const r = buildRewindConfirmText({ canRewind: false })
    expect(r.ok).toBe(false)
    expect(r.text).toBe('当前会话无可回退的检查点')
  })

  test('canRewind:true + filesChanged 为空 → 无改动提示，ok:false', () => {
    const r = buildRewindConfirmText({ canRewind: true, filesChanged: [], insertions: 0, deletions: 0 })
    expect(r.ok).toBe(false)
    expect(r.text).toBe('无文件改动，无需回退')
  })

  test('canRewind:true + filesChanged 缺省（undefined） → 视为 0 个文件，ok:false', () => {
    const r = buildRewindConfirmText({ canRewind: true })
    expect(r.ok).toBe(false)
    expect(r.text).toBe('无文件改动，无需回退')
  })

  test('canRewind:true + 有改动 → 返回含文件数 + 行数的确认文案，ok:true', () => {
    const preview: RewindPreview = { canRewind: true, filesChanged: ['a.ts', 'b.ts'], insertions: 12, deletions: 5 }
    const r = buildRewindConfirmText(preview)
    expect(r.ok).toBe(true)
    expect(r.text).toBe('将回退 2 个文件 · +12 −5 行，确认回退？')
  })

  test('有文件改动但行数均为 0 → 文案仅含文件数（不显示行数）', () => {
    const preview: RewindPreview = { canRewind: true, filesChanged: ['x.ts'], insertions: 0, deletions: 0 }
    const r = buildRewindConfirmText(preview)
    expect(r.ok).toBe(true)
    expect(r.text).toBe('将回退 1 个文件，确认回退？')
  })

  test('单个文件 + 行数变化 → 数字准确', () => {
    const r = buildRewindConfirmText({ canRewind: true, filesChanged: ['index.ts'], insertions: 3, deletions: 7 })
    expect(r.ok).toBe(true)
    expect(r.text).toBe('将回退 1 个文件 · +3 −7 行，确认回退？')
  })
})
