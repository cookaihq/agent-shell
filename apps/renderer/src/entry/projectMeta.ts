// projectMeta.ts — 项目卡派生展示工具（纯函数）
import type { ProjectStatus } from '../api/types'

/** 名称 → 2 字母 glyph：优先拉丁词首字母，无则取前 2 字符。 */
export function glyph(name: string): string {
  const words = name.trim().split(/[\s\-_]+/).filter(Boolean)
  const latin = words.map((w) => w[0]).filter((c) => /[a-zA-Z]/.test(c))
  if (latin.length >= 2) return (latin[0] + latin[1]).toUpperCase()
  if (latin.length === 1) return latin[0].toUpperCase()
  return name.trim().slice(0, 2)
}

const STATUS_CLASS: Record<ProjectStatus, string> = {
  running: 'st-running', completed: 'st-ok', failed: 'st-failed', aborted: 'st-idle', idle: 'st-idle',
}
const STATUS_LABEL: Record<ProjectStatus, string> = {
  running: '运行中', completed: '已完成', failed: '失败', aborted: '已中止', idle: '未开始',
}
export const statusClass = (s: ProjectStatus): string => STATUS_CLASS[s]
export const statusLabel = (s: ProjectStatus): string => STATUS_LABEL[s]

/** 相对时间（now 可注入，便于测试；默认 Date.now()）。 */
export function relativeTime(ts: number, now: number = Date.now()): string {
  const d = Math.max(0, now - ts)
  const min = 60_000, hr = 3600_000, day = 86400_000
  if (d < min) return '刚刚'
  if (d < hr) return `${Math.floor(d / min)} 分钟前`
  if (d < day) return `${Math.floor(d / hr)} 小时前`
  if (d < 2 * day) return '昨天'
  return `${Math.floor(d / day)} 天前`
}
