import { describe, it, expect } from 'vitest'
import { openDatabase } from '../database'
import { createProject, getProject, listProjects, renameProject } from '../projects'

describe('projects repo', () => {
  it('建项目 → 查回（id 32 位无连字符，created_at 自动）', () => {
    const db = openDatabase(':memory:')
    const p = createProject(db, { name: '种子路演稿', path: '~/AgentShell/projects/abc' })
    expect(p.id).toMatch(/^[0-9a-f]{32}$/)
    expect(p.createdAt).toBeGreaterThan(0)
    expect(getProject(db, p.id)).toMatchObject({ id: p.id, name: '种子路演稿', path: '~/AgentShell/projects/abc' })
    db.close()
  })

  it('重命名（与目录名解耦，path 不变）', () => {
    const db = openDatabase(':memory:')
    const p = createProject(db, { name: '旧名', path: '/p' })
    renameProject(db, p.id, '新名')
    expect(getProject(db, p.id)).toMatchObject({ name: '新名', path: '/p' })
    db.close()
  })

  it('列表按 created_at 倒序（最近在前）', () => {
    const db = openDatabase(':memory:')
    const a = createProject(db, { name: 'A', path: '/a' })
    const b = createProject(db, { name: 'B', path: '/b' })
    expect(listProjects(db).map((p) => p.id).slice(0, 2)).toEqual([b.id, a.id])
    db.close()
  })

  it('查不存在 → undefined', () => {
    const db = openDatabase(':memory:')
    expect(getProject(db, 'nope')).toBeUndefined()
    db.close()
  })

  it('createProject：传入 id 则用该 id（目录名=id 对齐 spec）', () => {
    const db = openDatabase(':memory:')
    const proj = createProject(db, { id: 'fixedid32', name: 'p', path: '/x/fixedid32' })
    expect(proj.id).toBe('fixedid32')
  })
})
