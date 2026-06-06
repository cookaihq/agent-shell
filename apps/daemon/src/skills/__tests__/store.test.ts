import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { scanSkills } from '../store'

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
