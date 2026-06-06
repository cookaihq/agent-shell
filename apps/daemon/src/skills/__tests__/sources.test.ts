import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { makeSourceStore } from '../sources'

let dir: string, file: string, store: ReturnType<typeof makeSourceStore>
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-')); file = path.join(dir, 'skill-sources.json'); store = makeSourceStore(file) })
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('source store', () => {
  it('add 生成 id + 递增 sortIndex，文件 0600', () => {
    const a = store.add({ type: 'folder', name: 'a', loc: '/x/a', updateMode: 'manual' })
    const b = store.add({ type: 'git', name: 'o/r', loc: 'github.com/o/r', updateMode: 'manual' })
    expect(a.id).toBeTruthy(); expect(b.sortIndex).toBe(a.sortIndex + 1)
    expect((fs.statSync(file).mode & 0o777)).toBe(0o600)
  })
  it('list 按 sortIndex 排序', () => {
    const a = store.add({ type: 'folder', name: 'a', loc: '/a', updateMode: 'manual' })
    const b = store.add({ type: 'folder', name: 'b', loc: '/b', updateMode: 'manual' })
    store.reorder([b.id, a.id])
    expect(store.list().map(s => s.name)).toEqual(['b', 'a'])
  })
  it('patch / remove', () => {
    const a = store.add({ type: 'git', name: 'o/r', loc: 'github.com/o/r', updateMode: 'manual' })
    store.patch(a.id, { updateMode: 'auto', name: 'o/renamed' })
    expect(store.list()[0].updateMode).toBe('auto'); expect(store.list()[0].name).toBe('o/renamed')
    store.remove(a.id); expect(store.list()).toEqual([])
  })
})
