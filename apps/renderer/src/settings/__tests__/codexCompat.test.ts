import { isTestedCodexVersion, TESTED_CODEX_VERSIONS } from '../codexCompat'

test('已测试集合当前锁定 codex 0.137.0（Part A 基线）', () => {
  expect(TESTED_CODEX_VERSIONS).toContain('0.137.0')
})

test('集合内版本判为已测试', () => {
  expect(isTestedCodexVersion('0.137.0')).toBe(true)
  expect(isTestedCodexVersion(' 0.137.0 ')).toBe(true) // 容忍首尾空白
})

test('集合外版本（更新/更旧）判为未测试', () => {
  expect(isTestedCodexVersion('0.140.0')).toBe(false)
  expect(isTestedCodexVersion('0.130.0')).toBe(false)
})

test('版本缺失判为未测试', () => {
  expect(isTestedCodexVersion(null)).toBe(false)
  expect(isTestedCodexVersion(undefined)).toBe(false)
  expect(isTestedCodexVersion('')).toBe(false)
})
