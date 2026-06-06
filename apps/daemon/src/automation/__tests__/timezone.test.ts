import { describe, it, expect } from 'vitest'
import { partsInTimezone, tzOffsetMinutes, tzWallToUtcCandidates, nextHourlyRunAt } from '../timezone'

describe('partsInTimezone', () => {
  it('Asia/Shanghai = UTC+8 wall clock', () => {
    const p = partsInTimezone('Asia/Shanghai', new Date(Date.UTC(2026, 0, 1, 1, 0, 0))) // 01:00Z = 09:00 上海
    expect(p.year).toBe(2026)
    expect(p.month).toBe(1)
    expect(p.day).toBe(1)
    expect(p.hour).toBe(9)
    expect(p.minute).toBe(0)
    expect(p.weekday).toBe(4) // 2026-01-01 周四
  })
})

describe('tzOffsetMinutes', () => {
  it('上海恒 +480', () => {
    expect(tzOffsetMinutes('Asia/Shanghai', new Date(Date.UTC(2026, 0, 1, 1, 0, 0)))).toBe(480)
    expect(tzOffsetMinutes('Asia/Shanghai', new Date(Date.UTC(2026, 6, 1, 1, 0, 0)))).toBe(480)
  })
  it('纽约夏令时 -240 / 冬令时 -300', () => {
    expect(tzOffsetMinutes('America/New_York', new Date(Date.UTC(2026, 6, 1, 12, 0, 0)))).toBe(-240) // 7月 EDT
    expect(tzOffsetMinutes('America/New_York', new Date(Date.UTC(2026, 0, 1, 12, 0, 0)))).toBe(-300) // 1月 EST
  })
})

describe('tzWallToUtcCandidates', () => {
  it('普通日恰好 1 个候选', () => {
    const c = tzWallToUtcCandidates('Asia/Shanghai', 2026, 1, 1, 9, 0)
    expect(c).toHaveLength(1)
    expect(c[0].getTime()).toBe(Date.UTC(2026, 0, 1, 1, 0, 0)) // 09:00 上海 = 01:00Z
  })
  it('纽约秋季回拨当天 01:30 有 2 个候选', () => {
    // 2026-11-01 美国 DST 结束，02:00→01:00，01:30 出现两次
    const c = tzWallToUtcCandidates('America/New_York', 2026, 11, 1, 1, 30)
    expect(c).toHaveLength(2)
  })
  it('非法时区返回 []', () => {
    expect(tzWallToUtcCandidates('Not/AZone', 2026, 1, 1, 9, 0)).toEqual([])
  })
})

describe('nextHourlyRunAt', () => {
  it('当前小时第 M 分在未来 → 本小时', () => {
    const from = new Date(Date.UTC(2026, 0, 1, 10, 5, 0))
    const r = nextHourlyRunAt(30, from)
    expect(r.getUTCMinutes()).toBe(30)
    expect(r.getTime() - from.getTime()).toBe(25 * 60_000)
  })
  it('当前小时第 M 分已过 → 下一小时', () => {
    const from = new Date(Date.UTC(2026, 0, 1, 10, 45, 0))
    const r = nextHourlyRunAt(30, from)
    expect(r.getUTCMinutes()).toBe(30)
    expect(r.getTime()).toBe(Date.UTC(2026, 0, 1, 11, 30, 0))
  })
})
