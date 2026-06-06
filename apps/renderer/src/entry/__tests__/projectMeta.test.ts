import { describe, it, expect } from 'vitest'
import { KANBAN_ORDER, SORTS, filterProjects, glyph, relativeTime, sortProjects, statusClass, statusLabel } from '../projectMeta'
import type { ProjectDTO } from '../../api/types'

const mk = (id: string, name: string, createdAt: number, status: ProjectDTO['status']): ProjectDTO =>
  ({ id, name, path: '/' + id, createdAt, status, engine: 'claude' })

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

describe('sortProjects', () => {
  const list = [mk('a', 'zeta', 1000, 'idle'), mk('b', 'alpha', 3000, 'running'), mk('c', 'mid', 2000, 'completed')]
  it('created：createdAt 倒序', () => {
    expect(sortProjects(list, 'created').map((p) => p.id)).toEqual(['b', 'c', 'a'])
  })
  it('name：localeCompare 升序', () => {
    expect(sortProjects(list, 'name').map((p) => p.name)).toEqual(['alpha', 'mid', 'zeta'])
  })
  it('status：按 KANBAN_ORDER，平手按 createdAt 倒序', () => {
    // idle(0) < running(1) < completed(2)
    expect(sortProjects(list, 'status').map((p) => p.id)).toEqual(['a', 'b', 'c'])
  })
  it('不改原数组', () => {
    const orig = list.map((p) => p.id)
    sortProjects(list, 'name')
    expect(list.map((p) => p.id)).toEqual(orig)
  })
})

describe('filterProjects', () => {
  const list = [mk('a', 'api-gateway', 1, 'idle'), mk('b', 'seed-deck', 2, 'idle')]
  it('子串过滤、大小写不敏感', () => {
    expect(filterProjects(list, 'API').map((p) => p.id)).toEqual(['a'])
  })
  it('空查询返回全部', () => {
    expect(filterProjects(list, '  ')).toHaveLength(2)
  })
})

describe('SORTS / KANBAN_ORDER', () => {
  it('排序项为 最近创建/名称/状态（无最近更新）', () => {
    expect(SORTS.map((s) => s.key)).toEqual(['created', 'name', 'status'])
  })
  it('看板列顺序为真实 5 态', () => {
    expect(KANBAN_ORDER).toEqual(['idle', 'running', 'completed', 'failed', 'aborted'])
  })
})
