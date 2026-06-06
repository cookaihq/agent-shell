/**
 * getContextWindowSize.test.ts — Task 1.5 TDD
 *
 * 验证：claudeSlice.getContextWindowSize 按模型 id 返回正确窗口大小；
 * codexSlice 不实现（undefined）。
 */
import { test, expect } from 'vitest'
import { getSlice } from '../registry'

test('getSlice("claude").getContextWindowSize("claude-opus-4-8") === 200000', () => {
  expect(getSlice('claude').getContextWindowSize!('claude-opus-4-8')).toBe(200_000)
})

test('getSlice("claude").getContextWindowSize("claude-opus-4-8[1m]") === 1000000', () => {
  expect(getSlice('claude').getContextWindowSize!('claude-opus-4-8[1m]')).toBe(1_000_000)
})

test('getSlice("claude").getContextWindowSize("CLAUDE-OPUS-4-8[1M]") === 1000000（大小写不敏感）', () => {
  expect(getSlice('claude').getContextWindowSize!('CLAUDE-OPUS-4-8[1M]')).toBe(1_000_000)
})

test('getSlice("claude").getContextWindowSize("claude-sonnet-4-5") === 200000（无 1m）', () => {
  expect(getSlice('claude').getContextWindowSize!('claude-sonnet-4-5')).toBe(200_000)
})

test('getSlice("codex").getContextWindowSize === undefined', () => {
  expect(getSlice('codex').getContextWindowSize).toBeUndefined()
})
