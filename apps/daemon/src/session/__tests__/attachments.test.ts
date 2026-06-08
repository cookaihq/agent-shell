import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { resolveAttachments, buildPromptWithAttachments, appendCurrentFile } from '../attachments'

let cleanup: string[] = []
afterEach(() => { for (const d of cleanup) fs.rmSync(d, { recursive: true, force: true }); cleanup = [] })
function tmpdir(prefix: string): string { const d = fs.mkdtempSync(path.join(os.tmpdir(), prefix)); cleanup.push(d); return d }

describe('resolveAttachments — 路径分类 + 授权目录', () => {
  it('项目内文件 → 相对 posix 路径，无外部授权目录', () => {
    const cwd = tmpdir('as-cwd-')
    fs.mkdirSync(path.join(cwd, 'attachments'))
    fs.writeFileSync(path.join(cwd, 'attachments', 'a.png'), 'x')
    const r = resolveAttachments(cwd, ['attachments/a.png'])
    expect(r.listed).toEqual([{ name: 'a.png', path: 'attachments/a.png' }])
    expect(r.externalDirs).toEqual([])
  })
  it('项目外文件 → 绝对路径，授权其所在目录', () => {
    const cwd = tmpdir('as-cwd-'); const ext = tmpdir('as-ext-')
    const f = path.join(ext, 'doc.pdf'); fs.writeFileSync(f, 'x')
    const r = resolveAttachments(cwd, [f])
    expect(r.listed).toEqual([{ name: 'doc.pdf', path: f }])
    expect(r.externalDirs).toEqual([ext])           // 文件 → 父目录
  })
  it('项目外文件夹 → 绝对路径，授权该文件夹本身', () => {
    const cwd = tmpdir('as-cwd-'); const ext = tmpdir('as-ext-')
    const sub = path.join(ext, 'refs'); fs.mkdirSync(sub); fs.writeFileSync(path.join(sub, 'k.ts'), 'x')
    const r = resolveAttachments(cwd, [sub])
    expect(r.listed).toEqual([{ name: 'refs', path: sub }])
    expect(r.externalDirs).toEqual([sub])           // 文件夹 → 自身
  })
  it('不存在的路径 → 静默丢弃', () => {
    const cwd = tmpdir('as-cwd-')
    expect(resolveAttachments(cwd, ['ghost.txt', '/nope/x'])).toEqual({ listed: [], externalDirs: [] })
  })
  it('多个外部文件同目录 → 授权目录去重', () => {
    const cwd = tmpdir('as-cwd-'); const ext = tmpdir('as-ext-')
    fs.writeFileSync(path.join(ext, 'a'), '1'); fs.writeFileSync(path.join(ext, 'b'), '2')
    const r = resolveAttachments(cwd, [path.join(ext, 'a'), path.join(ext, 'b')])
    expect(r.externalDirs).toEqual([ext])
  })
})

describe('buildPromptWithAttachments — preamble', () => {
  it('有附件 → 末尾追加 Attached project files 行', () => {
    const out = buildPromptWithAttachments('帮我看下', [
      { name: 'a.png', path: 'attachments/a.png' },
      { name: 'doc.pdf', path: '/ext/doc.pdf' },
    ])
    expect(out).toBe('帮我看下\n\nAttached project files: `attachments/a.png`, `/ext/doc.pdf`')
  })
  it('无附件 → 原文不变', () => {
    expect(buildPromptWithAttachments('你好', [])).toBe('你好')
  })
})

describe('appendCurrentFile — 当前文件独立块', () => {
  it('有 activeFile → 末尾追加 <current_file> 块', () => {
    expect(appendCurrentFile('帮我看下', 'src/foo.ts'))
      .toBe('帮我看下\n\n<current_file>src/foo.ts</current_file>')
  })
  it('与附件 preamble 并存 → current_file 在最后、各自分行', () => {
    const withAttach = buildPromptWithAttachments('q', [{ name: 'a.png', path: 'attachments/a.png' }])
    expect(appendCurrentFile(withAttach, 'src/b.ts'))
      .toBe('q\n\nAttached project files: `attachments/a.png`\n\n<current_file>src/b.ts</current_file>')
  })
  it('null / undefined / 空串 → 原文不变', () => {
    expect(appendCurrentFile('你好', null)).toBe('你好')
    expect(appendCurrentFile('你好', undefined)).toBe('你好')
    expect(appendCurrentFile('你好', '')).toBe('你好')
  })
})
