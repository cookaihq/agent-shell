import { describe, it, expect } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { readCategories, writeCategories } from '../automationCategories'

describe('automationCategories', () => {
  it('缺文件 → {tree:[]}；write 后 read 等价', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat-'))
    const file = path.join(dir, 'automation-categories.json')
    expect(readCategories(file)).toEqual({ tree: [] })
    const tree = [{ name: '运营', children: [{ name: '监控' }] }, { name: '工程' }]
    writeCategories(file, tree)
    expect(readCategories(file)).toEqual({ tree })
    fs.rmSync(dir, { recursive: true, force: true })
  })

  it('损坏 JSON / 非法树 → 回退 {tree:[]}（不抛）', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cat2-'))
    const file = path.join(dir, 'c.json'); fs.writeFileSync(file, '{bad')
    expect(readCategories(file)).toEqual({ tree: [] })
    fs.rmSync(dir, { recursive: true, force: true })
  })
})
