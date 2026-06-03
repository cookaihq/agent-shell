import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { scanTree, readProjectFile, importFiles, FileAccessError } from '../files'

let tmp = ''
afterEach(() => { if (tmp) fs.rmSync(tmp, { recursive: true, force: true }); tmp = '' })
function fixture(): string {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-files-'))
  fs.mkdirSync(path.join(tmp, 'src')); fs.writeFileSync(path.join(tmp, 'src', 'a.ts'), 'a')
  fs.writeFileSync(path.join(tmp, 'README.md'), '# hi')
  fs.mkdirSync(path.join(tmp, 'node_modules')); fs.writeFileSync(path.join(tmp, 'node_modules', 'j.js'), 'j')
  return tmp
}
describe('scanTree', () => {
  it('嵌套树，目录在前，忽略 node_modules，posix 相对路径', () => {
    const t = scanTree(fixture()); const names = t.map((n) => n.name)
    expect(names).toContain('src'); expect(names).toContain('README.md'); expect(names).not.toContain('node_modules')
    expect(names.indexOf('src')).toBeLessThan(names.indexOf('README.md'))
    const src = t.find((n) => n.name === 'src')!
    expect(src).toMatchObject({ type: 'dir', path: 'src' })
    expect(src.children![0]).toMatchObject({ name: 'a.ts', path: 'src/a.ts', type: 'file' })
  })
  it('maxNodes 上限', () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-files-'))
    for (let i = 0; i < 10; i++) fs.writeFileSync(path.join(tmp, `f${i}`), 'x')
    expect(scanTree(tmp, { maxNodes: 3 }).length).toBeLessThanOrEqual(3)
  })
})
describe('readProjectFile', () => {
  it('读内容', () => { expect(readProjectFile(fixture(), 'README.md')).toEqual({ content: '# hi', truncated: false }) })
  it('超限截断', () => { const r = fixture(); fs.writeFileSync(path.join(r, 'b'), 'abcdefghij'); expect(readProjectFile(r, 'b', 4)).toEqual({ content: 'abcd', truncated: true }) })
  it('越界/不存在/目录', () => {
    const r = fixture()
    expect(() => readProjectFile(r, '../../etc/passwd')).toThrow(FileAccessError)
    try { readProjectFile(r, '../x') } catch (e) { expect((e as FileAccessError).reason).toBe('out_of_bounds') }
    try { readProjectFile(r, 'nope') } catch (e) { expect((e as FileAccessError).reason).toBe('not_found') }
    try { readProjectFile(r, 'src') } catch (e) { expect((e as FileAccessError).reason).toBe('not_a_file') }
  })
})

describe('importFiles', () => {
  // 在 tmp 外另建一个源目录，模拟从项目外拖入
  function withSource(): { root: string; srcDir: string } {
    const root = fixture()
    const srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-src-'))
    return { root, srcDir }
  }
  it('复制文件进项目根', () => {
    const { root, srcDir } = withSource()
    const f = path.join(srcDir, 'note.txt'); fs.writeFileSync(f, 'hello')
    const out = importFiles(root, [f])
    expect(out).toEqual([{ name: 'note.txt', from: path.resolve(f) }])
    expect(fs.readFileSync(path.join(root, 'note.txt'), 'utf8')).toBe('hello')
    fs.rmSync(srcDir, { recursive: true, force: true })
  })
  it('递归复制文件夹', () => {
    const { root, srcDir } = withSource()
    const dir = path.join(srcDir, 'assets'); fs.mkdirSync(dir); fs.writeFileSync(path.join(dir, 'x.png'), 'x')
    importFiles(root, [dir])
    expect(fs.readFileSync(path.join(root, 'assets', 'x.png'), 'utf8')).toBe('x')
    fs.rmSync(srcDir, { recursive: true, force: true })
  })
  it('同名加后缀保留两份，不覆盖', () => {
    const { root, srcDir } = withSource()
    // 项目里已有 README.md（fixture 写了 '# hi'）
    const f = path.join(srcDir, 'README.md'); fs.writeFileSync(f, 'NEW')
    const out = importFiles(root, [f])
    expect(out[0].name).toBe('README (1).md')
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe('# hi')        // 原文件不动
    expect(fs.readFileSync(path.join(root, 'README (1).md'), 'utf8')).toBe('NEW')      // 副本加后缀
    fs.rmSync(srcDir, { recursive: true, force: true })
  })
  it('跳过不存在 / 项目内自身路径', () => {
    const { root, srcDir } = withSource()
    const inside = path.join(root, 'README.md')            // 已在项目内
    const ghost = path.join(srcDir, 'nope.txt')            // 不存在
    expect(importFiles(root, [inside, ghost])).toEqual([])
    fs.rmSync(srcDir, { recursive: true, force: true })
  })
})
