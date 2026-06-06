import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { scanTree, readProjectFile, resolveProjectFile, resolveProjectPath, renameEntry, moveEntry, importFiles, saveAttachmentBytes, FileAccessError } from '../files'

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
  it('软链接目录：跟随解析为 dir、标 symlink、递归出子节点（技能注入场景）', () => {
    const root = fixture()
    // 在项目外建一个“技能库”目录，内含 SKILL.md，软链进项目（模拟 injectClaudeSkills）
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'as-skill-'))
    fs.writeFileSync(path.join(lib, 'SKILL.md'), '# skill')
    fs.symlinkSync(lib, path.join(root, 'my-skill'), 'dir')
    const t = scanTree(root)
    const node = t.find((n) => n.name === 'my-skill')!
    expect(node).toMatchObject({ type: 'dir', path: 'my-skill', symlink: true })
    expect(node.children!.map((c) => c.name)).toContain('SKILL.md')
    fs.rmSync(lib, { recursive: true, force: true })
  })
  it('软链接文件：跟随解析为 file、标 symlink', () => {
    const root = fixture()
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'as-link-'))
    const target = path.join(lib, 'real.txt'); fs.writeFileSync(target, 'x')
    fs.symlinkSync(target, path.join(root, 'alias.txt'), 'file')
    const node = scanTree(root).find((n) => n.name === 'alias.txt')!
    expect(node).toMatchObject({ type: 'file', path: 'alias.txt', symlink: true })
    fs.rmSync(lib, { recursive: true, force: true })
  })
  it('悬空软链接（目标已删）：跳过、不报错', () => {
    const root = fixture()
    fs.symlinkSync(path.join(root, '__missing__'), path.join(root, 'dangling'), 'file')
    expect(scanTree(root).find((n) => n.name === 'dangling')).toBeUndefined()
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

describe('resolveProjectFile', () => {
  it('返回项目内文件的绝对路径', () => {
    const r = fixture()
    expect(resolveProjectFile(r, 'README.md')).toBe(path.join(path.resolve(r), 'README.md'))
  })
  it('越界/不存在/目录 抛错', () => {
    const r = fixture()
    try { resolveProjectFile(r, '../x') } catch (e) { expect((e as FileAccessError).reason).toBe('out_of_bounds') }
    try { resolveProjectFile(r, 'nope') } catch (e) { expect((e as FileAccessError).reason).toBe('not_found') }
    try { resolveProjectFile(r, 'src') } catch (e) { expect((e as FileAccessError).reason).toBe('not_a_file') }
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
  it('dir 参：复制进子目录 <root>/<dir>/，自动建夹', () => {
    const { root, srcDir } = withSource()
    const f = path.join(srcDir, 'note.txt'); fs.writeFileSync(f, 'hello')
    const out = importFiles(root, [f], 'attachments')
    expect(out).toEqual([{ name: 'note.txt', from: path.resolve(f) }])
    expect(fs.existsSync(path.join(root, 'attachments'))).toBe(true)        // 自动建夹
    expect(fs.readFileSync(path.join(root, 'attachments', 'note.txt'), 'utf8')).toBe('hello')
    expect(fs.existsSync(path.join(root, 'note.txt'))).toBe(false)          // 不落项目根
    fs.rmSync(srcDir, { recursive: true, force: true })
  })
  it('dir 参：同名在子目录内去重，不与项目根冲突', () => {
    const { root, srcDir } = withSource()
    fs.mkdirSync(path.join(root, 'attachments'))
    fs.writeFileSync(path.join(root, 'attachments', 'a.txt'), 'OLD')
    const f = path.join(srcDir, 'a.txt'); fs.writeFileSync(f, 'NEW')
    const out = importFiles(root, [f], 'attachments')
    expect(out[0].name).toBe('a (1).txt')
    expect(fs.readFileSync(path.join(root, 'attachments', 'a.txt'), 'utf8')).toBe('OLD')
    expect(fs.readFileSync(path.join(root, 'attachments', 'a (1).txt'), 'utf8')).toBe('NEW')
    fs.rmSync(srcDir, { recursive: true, force: true })
  })
})

describe('saveAttachmentBytes（粘贴字节写盘）', () => {
  it('写进 <root>/<dir>/，自动建夹，返回相对 posix 路径 + 大小', () => {
    const root = fixture()
    const data = Buffer.from('PNGDATA')
    const out = saveAttachmentBytes(root, 'attachments', 'pasted-1.png', data)
    expect(out).toEqual({ name: 'pasted-1.png', path: 'attachments/pasted-1.png', size: 7 })
    expect(fs.readFileSync(path.join(root, 'attachments', 'pasted-1.png'))).toEqual(data)
  })
  it('同名去重', () => {
    const root = fixture()
    fs.mkdirSync(path.join(root, 'attachments'))
    fs.writeFileSync(path.join(root, 'attachments', 'x.png'), 'OLD')
    const out = saveAttachmentBytes(root, 'attachments', 'x.png', Buffer.from('NEW'))
    expect(out.name).toBe('x (1).png')
    expect(out.path).toBe('attachments/x (1).png')
    expect(fs.readFileSync(path.join(root, 'attachments', 'x.png'), 'utf8')).toBe('OLD')
  })
})

describe('resolveProjectPath（放宽：目录也放行）', () => {
  it('文件 / 目录都返回绝对路径', () => {
    const r = fixture()
    expect(resolveProjectPath(r, 'README.md')).toBe(path.join(path.resolve(r), 'README.md'))
    expect(resolveProjectPath(r, 'src')).toBe(path.join(path.resolve(r), 'src'))   // 目录不再抛 not_a_file
  })
  it('越界 / 不存在仍抛', () => {
    const r = fixture()
    try { resolveProjectPath(r, '../x'); expect.unreachable() } catch (e) { expect((e as FileAccessError).reason).toBe('out_of_bounds') }
    try { resolveProjectPath(r, 'nope'); expect.unreachable() } catch (e) { expect((e as FileAccessError).reason).toBe('not_found') }
  })
})

describe('renameEntry', () => {
  it('文件同目录改名，返回新相对路径', () => {
    const r = fixture()
    expect(renameEntry(r, 'src/a.ts', 'b.ts')).toBe('src/b.ts')
    expect(fs.existsSync(path.join(r, 'src', 'b.ts'))).toBe(true)
    expect(fs.existsSync(path.join(r, 'src', 'a.ts'))).toBe(false)
  })
  it('目录也能改名', () => {
    const r = fixture()
    expect(renameEntry(r, 'src', 'lib')).toBe('lib')
    expect(fs.existsSync(path.join(r, 'lib', 'a.ts'))).toBe(true)
  })
  it('含路径分隔符 / . / .. 拒绝（invalid_name）', () => {
    const r = fixture()
    for (const bad of ['a/b.ts', 'a\\b.ts', '.', '..', '']) {
      try { renameEntry(r, 'README.md', bad); expect.unreachable() } catch (e) { expect((e as FileAccessError).reason).toBe('invalid_name') }
    }
  })
  it('目标重名拒绝（already_exists）', () => {
    const r = fixture()
    fs.writeFileSync(path.join(r, 'src', 'c.ts'), 'c')
    try { renameEntry(r, 'src/a.ts', 'c.ts'); expect.unreachable() } catch (e) { expect((e as FileAccessError).reason).toBe('already_exists') }
  })
  it('越界 / 源不存在 / 改根 拒绝', () => {
    const r = fixture()
    try { renameEntry(r, '../x', 'y'); expect.unreachable() } catch (e) { expect((e as FileAccessError).reason).toBe('out_of_bounds') }
    try { renameEntry(r, '', 'y'); expect.unreachable() } catch (e) { expect((e as FileAccessError).reason).toBe('out_of_bounds') }
    try { renameEntry(r, 'nope', 'y'); expect.unreachable() } catch (e) { expect((e as FileAccessError).reason).toBe('not_found') }
  })
})

describe('moveEntry', () => {
  it('把文件移进子目录，返回新旧相对路径', () => {
    const r = fixture()
    const moved = moveEntry(r, ['README.md'], 'src')
    expect(moved).toEqual([{ from: 'README.md', to: 'src/README.md' }])
    expect(fs.existsSync(path.join(r, 'src', 'README.md'))).toBe(true)
    expect(fs.existsSync(path.join(r, 'README.md'))).toBe(false)
  })
  it('移到项目根（destDir=\'\'）', () => {
    const r = fixture()
    fs.mkdirSync(path.join(r, 'sub')); fs.writeFileSync(path.join(r, 'sub', 'd.txt'), 'd')
    const moved = moveEntry(r, ['sub/d.txt'], '')
    expect(moved).toEqual([{ from: 'sub/d.txt', to: 'd.txt' }])
    expect(fs.existsSync(path.join(r, 'd.txt'))).toBe(true)
  })
  it('同名冲突去重不覆盖', () => {
    const r = fixture()
    fs.writeFileSync(path.join(r, 'src', 'README.md'), 'EXISTING')
    const moved = moveEntry(r, ['README.md'], 'src')
    expect(moved[0].to).toBe('src/README (1).md')
    expect(fs.readFileSync(path.join(r, 'src', 'README.md'), 'utf8')).toBe('EXISTING')   // 原文件不动
    expect(fs.readFileSync(path.join(r, 'src', 'README (1).md'), 'utf8')).toBe('# hi')    // 副本加后缀
  })
  it('已在目标目录中（同父）→ no-op 跳过', () => {
    const r = fixture()
    expect(moveEntry(r, ['src/a.ts'], 'src')).toEqual([])   // a.ts 已在 src 下
    expect(fs.existsSync(path.join(r, 'src', 'a.ts'))).toBe(true)
  })
  it('把目录移进自身 / 子孙 → 拒绝（invalid_move）', () => {
    const r = fixture()
    fs.mkdirSync(path.join(r, 'src', 'deep'))
    try { moveEntry(r, ['src'], 'src'); expect.unreachable() } catch (e) { expect((e as FileAccessError).reason).toBe('invalid_move') }
    try { moveEntry(r, ['src'], 'src/deep'); expect.unreachable() } catch (e) { expect((e as FileAccessError).reason).toBe('invalid_move') }
  })
  it('目标不是目录 → 拒绝（invalid_move）', () => {
    const r = fixture()
    try { moveEntry(r, ['src/a.ts'], 'README.md'); expect.unreachable() } catch (e) { expect((e as FileAccessError).reason).toBe('invalid_move') }
  })
  it('目标目录不存在 → not_found', () => {
    const r = fixture()
    try { moveEntry(r, ['README.md'], 'ghost'); expect.unreachable() } catch (e) { expect((e as FileAccessError).reason).toBe('not_found') }
  })
  it('越界 / 不存在的源静默跳过', () => {
    const r = fixture()
    expect(moveEntry(r, ['../escape', 'nope.txt'], 'src')).toEqual([])
  })
})
