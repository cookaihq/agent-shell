import { test, expect } from 'vitest'
import { getSlice, SLICES } from '../registry'

test('getSlice("claude").engine === "claude"', () => {
  expect(getSlice('claude').engine).toBe('claude')
})

test('getSlice("codex").engine === "codex"', () => {
  expect(getSlice('codex').engine).toBe('codex')
})

test('SLICES has exactly keys claude + codex', () => {
  expect(Object.keys(SLICES).sort()).toEqual(['claude', 'codex'])
})
