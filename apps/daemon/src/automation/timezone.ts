// 时区 wall-clock 数学 + DST fallback。
// 逐字移植自参考实现 open-design（tmp/open-design/apps/daemon/src/routines.ts，HEAD 67a8d7cc，只读）。
// 这块是定时器正确性的核心（夏令时「跳过的一小时」/「重复的一小时」都要正确），不自行另写。
// weekday：0=周日 … 6=周六。

export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

export function partsInTimezone(timezone: string, atUtc: Date): {
  year: number; month: number; day: number; hour: number; minute: number; second: number; weekday: Weekday
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timezone,
    hour12: false,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  })
  const parts = dtf.formatToParts(atUtc)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '0'
  const weekdayStr = get('weekday')
  const weekdayMap: Record<string, Weekday> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 }
  let h = Number(get('hour'))
  // Intl 在部分 locale/zone 午夜会给 "24"，归一化到 0。
  if (h === 24) h = 0
  return {
    year: Number(get('year')),
    month: Number(get('month')),
    day: Number(get('day')),
    hour: h,
    minute: Number(get('minute')),
    second: Number(get('second')),
    weekday: weekdayMap[weekdayStr] ?? 0,
  }
}

// UTC 偏移分钟数（东为正）。如 Asia/Shanghai 返回 480。
export function tzOffsetMinutes(timezone: string, at: Date): number {
  const p = partsInTimezone(timezone, at)
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second)
  return Math.round((asIfUtc - at.getTime()) / 60_000)
}

function matchesWallClock(timezone: string, at: Date, year: number, month: number, day: number, hour: number, minute: number): boolean {
  const p = partsInTimezone(timezone, at)
  return p.year === year && p.month === month && p.day === day && p.hour === hour && p.minute === minute
}

// 返回 timezone 内 wall clock 读作该 Y-M-D h:m 的所有 UTC 时刻，升序。
// 多数天恰好 1 个；fall-back 重复小时内有 2 个；spring-forward 跳过的时刻有 0 个（调用方走 gap fallback）。
// 在一天的 ±12h、0h 三个参考点采样偏移，确保 transition 两侧偏移都被采到。timezone 非法返回 []。
export function tzWallToUtcCandidates(timezone: string, year: number, month: number, day: number, hour: number, minute: number): Date[] {
  try {
    const tentative = Date.UTC(year, month - 1, day, hour, minute, 0)
    const probeOffsetsMs = [-12, 0, 12].map((h) => h * 60 * 60_000)
    const seen = new Set<number>()
    const out: Date[] = []
    for (const dms of probeOffsetsMs) {
      const off = tzOffsetMinutes(timezone, new Date(tentative + dms))
      const cand = new Date(tentative - off * 60_000)
      const t = cand.getTime()
      if (seen.has(t)) continue
      if (matchesWallClock(timezone, cand, year, month, day, hour, minute)) {
        seen.add(t)
        out.push(cand)
      }
    }
    return out.sort((a, b) => a.getTime() - b.getTime())
  } catch {
    return []
  }
}

// Spring-forward gap fallback：当请求的 wall time 在该天不存在（时钟跳过它），返回两个 probe 候选里较晚的那个——
// 该时刻已越过 transition，渲染为 gap 后第一个合法 wall time，使任务仍在当天触发（而非提前一小时）。非法时区返回 null。
export function tzWallToUtcGapFallback(timezone: string, year: number, month: number, day: number, hour: number, minute: number): Date | null {
  try {
    const tentative = Date.UTC(year, month - 1, day, hour, minute, 0)
    const t1 = tzOffsetMinutes(timezone, new Date(tentative))
    const candidate1 = new Date(tentative - t1 * 60_000)
    const t2 = tzOffsetMinutes(timezone, candidate1)
    const candidate2 = new Date(tentative - t2 * 60_000)
    return candidate1.getTime() > candidate2.getTime() ? candidate1 : candidate2
  } catch {
    return null
  }
}

export function nextHourlyRunAt(minute: number, now: Date): Date {
  const next = new Date(now)
  next.setSeconds(0, 0)
  next.setMinutes(minute)
  if (next.getTime() <= now.getTime()) next.setHours(next.getHours() + 1)
  return next
}

// 返回 timezone 内 wall clock 读作 "HH:MM" 且 predicate(weekday) 成立的下一个时刻。
// 最多向前 walk 14 个日历天（覆盖任意 weekday 模式）。
export function nextWallTimeMatching(timezone: string, time: string, predicate: (weekday: Weekday) => boolean, now: Date): Date | null {
  const m = /^(\d{2}):(\d{2})$/.exec(time)
  if (!m) return null
  const hour = Number(m[1])
  const minute = Number(m[2])
  if (!Number.isFinite(hour) || hour < 0 || hour > 23) return null
  if (!Number.isFinite(minute) || minute < 0 || minute > 59) return null

  for (let offset = 0; offset < 14; offset += 1) {
    const probe = new Date(now.getTime() + offset * 24 * 60 * 60_000)
    const parts = partsInTimezone(timezone, probe)
    if (!predicate(parts.weekday)) continue
    const candidates = tzWallToUtcCandidates(timezone, parts.year, parts.month, parts.day, hour, minute)
    if (candidates.length === 0) {
      // spring-forward gap：当天无合法 wall 时刻 → 取合成的 post-gap fallback，使任务仍当天触发。
      const fallback = tzWallToUtcGapFallback(timezone, parts.year, parts.month, parts.day, hour, minute)
      if (!fallback) return null
      if (fallback.getTime() > now.getTime()) return fallback
      continue
    }
    // 升序遍历候选：fall-back 重复小时当天，若 now 已过第一次出现（EDT），仍取第二次（EST）再走下一天。
    for (const candidate of candidates) {
      if (candidate.getTime() > now.getTime()) return candidate
    }
  }
  return null
}
