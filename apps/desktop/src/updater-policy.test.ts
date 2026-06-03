import { describe, expect, it } from 'vitest'
import {
  BACKOFF_INITIAL_MS,
  BACKOFF_MAX_MS,
  createVersionPromptGate,
  nextBackoffDelay,
} from './updater-policy'

describe('nextBackoffDelay（失败退避）', () => {
  it('首次失败等起步值 60s', () => {
    expect(nextBackoffDelay(1)).toBe(BACKOFF_INITIAL_MS)
  })

  it('按 2 的幂指数增长', () => {
    expect(nextBackoffDelay(2)).toBe(BACKOFF_INITIAL_MS * 2)
    expect(nextBackoffDelay(3)).toBe(BACKOFF_INITIAL_MS * 4)
    expect(nextBackoffDelay(4)).toBe(BACKOFF_INITIAL_MS * 8)
  })

  it('封顶在 30min，不会无限增长', () => {
    expect(nextBackoffDelay(100)).toBe(BACKOFF_MAX_MS)
  })

  it('入参小于 1 按 1 处理（兜底，不返回 0 或负数）', () => {
    expect(nextBackoffDelay(0)).toBe(BACKOFF_INITIAL_MS)
    expect(nextBackoffDelay(-5)).toBe(BACKOFF_INITIAL_MS)
  })

  it('支持自定义起步/上限', () => {
    expect(nextBackoffDelay(1, { initialMs: 1000, maxMs: 5000 })).toBe(1000)
    expect(nextBackoffDelay(10, { initialMs: 1000, maxMs: 5000 })).toBe(5000)
  })
})

describe('createVersionPromptGate（同版本去重）', () => {
  it('同一版本只放行一次', () => {
    const gate = createVersionPromptGate()
    expect(gate.shouldPrompt('1.2.0')).toBe(true)
    expect(gate.shouldPrompt('1.2.0')).toBe(false)
    expect(gate.shouldPrompt('1.2.0')).toBe(false)
  })

  it('不同版本各自放行一次', () => {
    const gate = createVersionPromptGate()
    expect(gate.shouldPrompt('1.2.0')).toBe(true)
    expect(gate.shouldPrompt('1.3.0')).toBe(true)
    expect(gate.shouldPrompt('1.2.0')).toBe(false)
  })

  it('空版本号一律不放行', () => {
    const gate = createVersionPromptGate()
    expect(gate.shouldPrompt('')).toBe(false)
    expect(gate.shouldPrompt(undefined)).toBe(false)
    expect(gate.shouldPrompt(null)).toBe(false)
  })

  it('各 gate 实例互不影响（进程内存态）', () => {
    const a = createVersionPromptGate()
    const b = createVersionPromptGate()
    expect(a.shouldPrompt('1.0.0')).toBe(true)
    expect(b.shouldPrompt('1.0.0')).toBe(true)
  })
})
