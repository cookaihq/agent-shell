// projectMeta.ts — 项目卡派生展示工具（纯函数）
import type { ProjectDTO, ProjectStatus } from '../api/types'

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

/** 看板列顺序（真实 5 态：未开始→运行中→已完成→失败→已中止）。 */
export const KANBAN_ORDER: ProjectStatus[] = ['idle', 'running', 'completed', 'failed', 'aborted']

/** 排序方式（左侧下拉，对照原型；真实数据无 updatedAt，故无「最近更新」）。 */
export type SortKey = 'created' | 'name' | 'status'
export const SORTS: { key: SortKey; label: string }[] = [
  { key: 'created', label: '最近创建' },
  { key: 'name', label: '名称' },
  { key: 'status', label: '状态' },
]

/** 按 sort key 排序（返回新数组，不改原数组）。created/status 平手按 createdAt 倒序。 */
export function sortProjects(list: ProjectDTO[], key: SortKey): ProjectDTO[] {
  const arr = list.slice()
  if (key === 'name') return arr.sort((a, b) => a.name.localeCompare(b.name))
  if (key === 'status') return arr.sort((a, b) => (KANBAN_ORDER.indexOf(a.status) - KANBAN_ORDER.indexOf(b.status)) || (b.createdAt - a.createdAt))
  return arr.sort((a, b) => b.createdAt - a.createdAt)
}

/** 按名称子串过滤（大小写不敏感；空查询返回原列表）。 */
export function filterProjects(list: ProjectDTO[], query: string): ProjectDTO[] {
  const q = query.trim().toLowerCase()
  return q ? list.filter((p) => p.name.toLowerCase().includes(q)) : list
}

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
