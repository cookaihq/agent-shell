import type { AutomationSchedule } from '@agent-shell/contracts'
import { nextHourlyRunAt, nextWallTimeMatching } from './timezone'

/**
 * 据 schedule + 起算时刻算下次触发（ms epoch）；无解返回 null。
 * - hourly：UTC 每小时第 minute 分。
 * - daily/weekdays/weekly：时区 wall-clock（含夏令时 gap/overlap fallback）。
 * weekdays predicate = 周一~周五（1..5）；weekly = 指定 weekday；daily = 恒真。
 */
export function nextRunAtForSchedule(schedule: AutomationSchedule, fromMs: number): number | null {
  const now = new Date(fromMs)
  let d: Date | null
  switch (schedule.kind) {
    case 'hourly':
      d = nextHourlyRunAt(schedule.minute, now)
      break
    case 'daily':
      d = nextWallTimeMatching(schedule.timezone, schedule.time, () => true, now)
      break
    case 'weekdays':
      d = nextWallTimeMatching(schedule.timezone, schedule.time, (w) => w >= 1 && w <= 5, now)
      break
    case 'weekly':
      d = nextWallTimeMatching(schedule.timezone, schedule.time, (w) => w === schedule.weekday, now)
      break
    default:
      d = null
  }
  return d ? d.getTime() : null
}
