import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanSkills, removeSkill, importFolderSkill } from '../store'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sk-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })
function mkSkill(root: string, name: string, desc: string) {
  fs.mkdirSync(path.join(root, name), { recursive: true })
  fs.writeFileSync(path.join(root, name, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n# ${name}`)
}

describe('scanSkills', () => {
  it('目录不存在 → 空数组', () => { expect(scanSkills(path.join(dir, 'nope'))).toEqual([]) })
  it('扫含 SKILL.md 的子目录，解析 desc，source=folder（无 .git）', () => {
    mkSkill(dir, 'brand-asset', '品牌资产')
    const out = scanSkills(dir)
    expect(out).toEqual([{ name: 'brand-asset', source: 'folder', origin: '', desc: '品牌资产' }])
  })
  it('跳过无 SKILL.md 的目录', () => {
    fs.mkdirSync(path.join(dir, 'empty'))
    mkSkill(dir, 'ok', 'x')
    expect(scanSkills(dir).map((s) => s.name)).toEqual(['ok'])
  })
})
describe('符号链接场景（真机冒烟回归）', () => {
  it('importFolderSkill 从符号链接源导入 → 库中是真实目录（已解引用），可被 scanSkills 扫到', () => {
    // 造一个真实技能目录，再造一个指向它的符号链接作为"源"
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-real-'))
    const realSkill = path.join(realDir, 'humanizer')
    fs.mkdirSync(realSkill, { recursive: true })
    fs.writeFileSync(path.join(realSkill, 'SKILL.md'), '---\nname: humanizer\ndescription: 去 AI 味\n---')
    const linkSrc = path.join(realDir, 'humanizer-link')
    fs.symlinkSync(realSkill, linkSrc, 'dir')

    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'as-lib-sym-'))
    const sk = importFolderSkill(lib, linkSrc)
    expect(sk).toMatchObject({ source: 'folder', desc: '去 AI 味' })
    // 库中条目应是真实目录（解引用），不是符号链接
    const dest = path.join(lib, path.basename(linkSrc))
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false)
    expect(fs.lstatSync(dest).isDirectory()).toBe(true)
    // scanSkills 能扫到
    expect(scanSkills(lib).map((s) => s.name)).toContain('humanizer-link')
    fs.rmSync(realDir, { recursive: true, force: true })
    fs.rmSync(lib, { recursive: true, force: true })
  })
  it('scanSkills 扫到符号链接形式的技能条目（库中条目本身是符号链接目录）', () => {
    const realDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-real2-'))
    const realSkill = path.join(realDir, 'brand')
    fs.mkdirSync(realSkill, { recursive: true })
    fs.writeFileSync(path.join(realSkill, 'SKILL.md'), '---\nname: brand\ndescription: 品牌\n---')
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'as-lib-sym2-'))
    // 库中手动放一个符号链接目录条目
    fs.symlinkSync(realSkill, path.join(lib, 'brand'), 'dir')
    const out = scanSkills(lib)
    expect(out.map((s) => s.name)).toContain('brand')
    expect(out.find((s) => s.name === 'brand')?.desc).toBe('品牌')
    fs.rmSync(realDir, { recursive: true, force: true })
    fs.rmSync(lib, { recursive: true, force: true })
  })
})
describe('removeSkill / importFolderSkill', () => {
  it('importFolderSkill 复制含 SKILL.md 的文件夹进库', () => {
    const src = path.join(dir, 'src-skill'); mkSkill(path.dirname(src), path.basename(src), '来自文件夹')
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'as-lib-'))
    const sk = importFolderSkill(lib, src)
    expect(sk).toMatchObject({ name: 'src-skill', source: 'folder', desc: '来自文件夹' })
    expect(fs.existsSync(path.join(lib, 'src-skill', 'SKILL.md'))).toBe(true)
    fs.rmSync(lib, { recursive: true, force: true })
  })
  it('importFolderSkill 缺 SKILL.md → 抛 SkillError', () => {
    const bad = path.join(dir, 'bad'); fs.mkdirSync(bad)
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), 'as-lib2-'))
    expect(() => importFolderSkill(lib, bad)).toThrow()
    fs.rmSync(lib, { recursive: true, force: true })
  })
  it('removeSkill 删库中目录', () => {
    mkSkill(dir, 'gone', 'x'); removeSkill(dir, 'gone')
    expect(fs.existsSync(path.join(dir, 'gone'))).toBe(false)
  })
})
