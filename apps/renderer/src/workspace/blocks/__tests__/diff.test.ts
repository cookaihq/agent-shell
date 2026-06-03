import { describe, test, expect } from 'vitest'
import { buildDiff } from '../diff'

test('行级增删', () => {
  expect(buildDiff('a\nb', 'a\nc')).toEqual({ del: ['a', 'b'], add: ['a', 'c'] })
})

test('空 old = 纯新增', () => {
  expect(buildDiff('', 'x')).toEqual({ del: [], add: ['x'] })
})

test('空 new = 纯删除', () => {
  expect(buildDiff('a\nb', '')).toEqual({ del: ['a', 'b'], add: [] })
})

test('多行增删', () => {
  const result = buildDiff('line1\nline2\nline3', 'line1\nnew2\nnew3')
  expect(result.del).toEqual(['line1', 'line2', 'line3'])
  expect(result.add).toEqual(['line1', 'new2', 'new3'])
})
