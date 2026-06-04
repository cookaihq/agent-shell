import { describe, test, expect } from 'vitest'
import { buildDiff } from '../diff'

// 真逐行 diff（Issue 25）：未变行应同时出现一次（ctx），不再旧串整段删 + 新串整段增。

test('行级增删：相同行保留为 ctx（出现一次），只标真正变化的行', () => {
  const r = buildDiff('a\nb', 'a\nc')
  expect(r.added).toBe(1)
  expect(r.removed).toBe(1)
  // 'a' 是上下文（出现一次），'b' 删除，'c' 新增
  const ctx = r.rows.filter((x) => x.type === 'ctx').map((x) => x.text)
  expect(ctx).toEqual(['a'])
  expect(r.rows.find((x) => x.type === 'del')?.text).toBe('b')
  expect(r.rows.find((x) => x.type === 'add')?.text).toBe('c')
})

test('空 old = 纯新增', () => {
  const r = buildDiff('', 'x')
  expect(r.added).toBe(1)
  expect(r.removed).toBe(0)
  expect(r.rows.map((x) => [x.type, x.text])).toEqual([['add', 'x']])
})

test('空 new = 纯删除', () => {
  const r = buildDiff('a\nb', '')
  expect(r.removed).toBe(2)
  expect(r.added).toBe(0)
  expect(r.rows.every((x) => x.type === 'del')).toBe(true)
})

test('多行：仅变化行计入 added/removed，未变行为 ctx', () => {
  const r = buildDiff('line1\nline2\nline3', 'line1\nnew2\nnew3')
  // line1 未变 → ctx 一次；line2/line3 删；new2/new3 增
  expect(r.rows.filter((x) => x.type === 'ctx').map((x) => x.text)).toEqual(['line1'])
  expect(r.added).toBe(2)
  expect(r.removed).toBe(2)
})

test('行号：ctx 双侧行号、add 仅新侧、del 仅旧侧', () => {
  const r = buildDiff('a\nb', 'a\nc')
  const ctxRow = r.rows.find((x) => x.type === 'ctx')!
  expect(ctxRow.oldNo).toBe(1)
  expect(ctxRow.newNo).toBe(1)
  const del = r.rows.find((x) => x.type === 'del')!
  expect(del.oldNo).toBe(2)
  expect(del.newNo).toBeUndefined()
  const add = r.rows.find((x) => x.type === 'add')!
  expect(add.newNo).toBe(2)
  expect(add.oldNo).toBeUndefined()
})
