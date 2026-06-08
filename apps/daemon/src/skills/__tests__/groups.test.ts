import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { makeGroupStore } from '../groups'

let dir: string; let file: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'grp-')); file = path.join(dir, 'skill-groups.json') })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('makeGroupStore', () => {
  it('add 生成 g_ 前缀 id + 递增 sortIndex；list 按 sortIndex 升序', () => {
    const s = makeGroupStore(file)
    const a = s.add({ name: 'A' }); const b = s.add({ name: 'B' })
    expect(a.id.startsWith('g_')).toBe(true)
    expect(b.sortIndex).toBeGreaterThan(a.sortIndex)
    expect(s.list().map(g => g.name)).toEqual(['A', 'B'])
  })
  it('patch 改名；remove 删除；reorder 重排；upsert 幂等', () => {
    const s = makeGroupStore(file)
    const a = s.add({ name: 'A' }); const b = s.add({ name: 'B' })
    expect(s.patch(a.id, { name: 'A2' }).name).toBe('A2')
    s.reorder([b.id, a.id]); expect(s.list().map(g => g.id)).toEqual([b.id, a.id])
    s.upsert({ id: 'builtin', name: '内置', sortIndex: -1 })
    s.upsert({ id: 'builtin', name: '内置', sortIndex: -1 })
    expect(s.list().filter(g => g.id === 'builtin').length).toBe(1)
    s.remove(a.id); expect(s.list().find(g => g.id === a.id)).toBeUndefined()
  })
  it('文件权限 0600', () => {
    const s = makeGroupStore(file); s.add({ name: 'A' })
    expect(fs.statSync(file).mode & 0o777).toBe(0o600)
  })
})
