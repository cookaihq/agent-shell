import { TIMEZONE_LABELS, type AutomationTriggerDef } from '@agent-shell/contracts'

export type Freq = '每小时' | '每天' | '工作日' | '每周'
export interface TimeTriggerForm { freq: Freq; time: string; tz: string; weekday: number }
const WEEKDAY_ZH = ['日', '一', '二', '三', '四', '五', '六']
const tzLabel = (tz: string) => TIMEZONE_LABELS[tz] ?? tz

export function triggerSummary(t: AutomationTriggerDef): string {
  if (t.kind === 'startup') return '启动时'
  if (t.kind === 'hourly') return `每小时 · 第 ${String(t.minute).padStart(2, '0')} 分`
  const tz = tzLabel(t.timezone)
  if (t.kind === 'daily') return `每天 ${t.time} · ${tz}`
  if (t.kind === 'weekdays') return `工作日 ${t.time} · ${tz}`
  return `每周${WEEKDAY_ZH[t.weekday]} ${t.time} · ${tz}`
}

export function formToDef(f: TimeTriggerForm): Exclude<AutomationTriggerDef, { kind: 'startup' }> {
  if (f.freq === '每小时') return { kind: 'hourly', minute: Number(f.time.split(':')[1] || 0) }
  if (f.freq === '工作日') return { kind: 'weekdays', time: f.time, timezone: f.tz }
  if (f.freq === '每周') return { kind: 'weekly', time: f.time, timezone: f.tz, weekday: f.weekday }
  return { kind: 'daily', time: f.time, timezone: f.tz }
}

export function defToForm(t: AutomationTriggerDef): TimeTriggerForm {
  if (t.kind === 'startup' || t.kind === 'hourly') {
    const time = t.kind === 'hourly' ? `00:${String(t.minute).padStart(2, '0')}` : '09:00'
    return { freq: t.kind === 'hourly' ? '每小时' : '每天', time, tz: 'Asia/Shanghai', weekday: 1 }
  }
  return {
    freq: t.kind === 'daily' ? '每天' : t.kind === 'weekdays' ? '工作日' : '每周',
    time: t.time, tz: t.timezone, weekday: t.kind === 'weekly' ? t.weekday : 1,
  }
}
