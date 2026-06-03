import { describe, it, expect } from 'vitest'
import { glyph, statusClass, statusLabel, relativeTime } from '../projectMeta'

describe('glyph', () => {
  it('取词首字母（最多2个）大写', () => {
    expect(glyph('seed-pitch-deck')).toBe('SP')
    expect(glyph('api gateway')).toBe('AG')
    expect(glyph('x')).toBe('X')
    expect(glyph('未命名项目')).toBe('未命')   // 无拉丁词 → 取前2字符
  })
})
describe('statusClass / statusLabel', () => {
  it('映射 5 态', () => {
    expect(statusClass('running')).toBe('st-running')
    expect(statusClass('completed')).toBe('st-ok')
    expect(statusClass('failed')).toBe('st-failed')
    expect(statusClass('aborted')).toBe('st-idle')
    expect(statusClass('idle')).toBe('st-idle')
    expect(statusLabel('running')).toBe('运行中')
    expect(statusLabel('completed')).toBe('已完成')
    expect(statusLabel('failed')).toBe('失败')
    expect(statusLabel('aborted')).toBe('已中止')
    expect(statusLabel('idle')).toBe('未开始')
  })
})
describe('relativeTime', () => {
  it('相对当前时间分档', () => {
    const now = 1_000_000_000_000
    expect(relativeTime(now - 30_000, now)).toBe('刚刚')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(relativeTime(now - 2 * 3600_000, now)).toBe('2 小时前')
    expect(relativeTime(now - 26 * 3600_000, now)).toBe('昨天')
    expect(relativeTime(now - 3 * 86400_000, now)).toBe('3 天前')
  })
})
