import { describe, it, expect } from 'vitest'
import { nextRunAtForSchedule } from '../nextRun'
import { partsInTimezone, tzOffsetMinutes } from '../timezone'

describe('nextRunAtForSchedule', () => {
  it('hourly：返回未来的第 M 分', () => {
    const from = Date.UTC(2026, 0, 1, 10, 5, 0)
    const r = nextRunAtForSchedule({ kind: 'hourly', minute: 30 }, from)!
    expect(new Date(r).getUTCMinutes()).toBe(30)
    expect(r).toBeGreaterThan(from)
    expect(r - from).toBeLessThanOrEqual(3600_000)
  })

  it('daily：当天时间未过 → 当天', () => {
    const from = Date.UTC(2026, 0, 1, 0, 0, 0) // 08:00 上海，早于 09:00
    const r = nextRunAtForSchedule({ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }, from)!
    expect(r).toBe(Date.UTC(2026, 0, 1, 1, 0, 0)) // 09:00 上海
  })
  it('daily：当天时间已过 → 次日', () => {
    const from = Date.UTC(2026, 0, 1, 2, 0, 0) // 10:00 上海，晚于 09:00
    const r = nextRunAtForSchedule({ kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' }, from)!
    expect(r).toBe(Date.UTC(2026, 0, 2, 1, 0, 0)) // 次日 09:00 上海
  })

  it('weekdays：周六触发 → 跳到周一', () => {
    // 2026-01-03 是周六（01-01 周四）
    const from = Date.UTC(2026, 0, 3, 5, 0, 0)
    const r = nextRunAtForSchedule({ kind: 'weekdays', time: '08:00', timezone: 'Asia/Shanghai' }, from)!
    const p = partsInTimezone('Asia/Shanghai', new Date(r))
    expect(p.weekday).toBe(1) // 周一
    expect(p.hour).toBe(8)
    expect(p.day).toBe(5)
  })

  it('weekly：命中下一个指定 weekday', () => {
    const from = Date.UTC(2026, 0, 1, 0, 0, 0) // 周四
    const r = nextRunAtForSchedule({ kind: 'weekly', time: '10:00', timezone: 'Asia/Shanghai', weekday: 1 }, from)!
    const p = partsInTimezone('Asia/Shanghai', new Date(r))
    expect(p.weekday).toBe(1)
    expect(p.hour).toBe(10)
  })

  it('DST spring-forward：02:30 不存在时落到 gap 后（EDT），且仍在当天', () => {
    // 2026-03-08 美国 DST 开始，02:00→03:00，02:30 wall 不存在
    const from = Date.UTC(2026, 2, 8, 5, 0, 0) // 当天 00:00 EST 附近，早于 02:30
    const r = nextRunAtForSchedule({ kind: 'daily', time: '02:30', timezone: 'America/New_York' }, from)
    expect(r).not.toBe(null)
    // 越过 transition → 偏移变 EDT(-240)，证明没在 gap 前提前触发、也没跳过当天
    expect(tzOffsetMinutes('America/New_York', new Date(r!))).toBe(-240)
    expect(partsInTimezone('America/New_York', new Date(r!)).day).toBe(8)
  })

  it('DST fall-back：01:30 重复小时取第一次出现（EDT）', () => {
    // 2026-11-01 美国 DST 结束，from 早于第一次 01:30
    const from = Date.UTC(2026, 10, 1, 4, 0, 0) // 00:00 EDT
    const r = nextRunAtForSchedule({ kind: 'daily', time: '01:30', timezone: 'America/New_York' }, from)!
    expect(tzOffsetMinutes('America/New_York', new Date(r))).toBe(-240) // 第一次 = EDT
  })
})
