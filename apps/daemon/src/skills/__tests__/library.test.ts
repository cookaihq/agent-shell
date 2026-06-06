import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { makeLibrary } from '../library'

let skillsDir: string, srcDir: string
const mkSkill = (base: string, rel: string, name: string) => {
  const p = path.join(base, rel); fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, 'SKILL.md'), `---\nname: ${name}\ndescription: d\n---\n`)
}
beforeEach(() => {
  skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lib-'))
  srcDir = fs.mkdtempSync(path.join(os.tmpdir(), 'src-'))
})
afterEach(() => { fs.rmSync(skillsDir, { recursive: true, force: true }); fs.rmSync(srcDir, { recursive: true, force: true }) })

describe('library materialize + 重名消歧', () => {
  it('入库 = 拷贝技能目录进 skillsDir，并记 manifest', () => {
    mkSkill(srcDir, 'pdf', 'pdf')
    const lib = makeLibrary(skillsDir)
    const eff = lib.add({ sourceId: 'A', name: 'pdf', srcSkillDir: path.join(srcDir, 'pdf'), relPath: 'pdf/' })
    expect(eff).toBe('pdf')
    expect(fs.existsSync(path.join(skillsDir, 'pdf', 'SKILL.md'))).toBe(true)
    expect(lib.manifest()['pdf']).toMatchObject({ sourceId: 'A', name: 'pdf', relPath: 'pdf/' })
  })
  it('不同源同名 → 第二个按源消歧 name__<sourceId>', () => {
    mkSkill(srcDir, 'a/pdf', 'pdf'); mkSkill(srcDir, 'b/pdf', 'pdf')
    const lib = makeLibrary(skillsDir)
    expect(lib.add({ sourceId: 'A', name: 'pdf', srcSkillDir: path.join(srcDir, 'a/pdf'), relPath: 'a/pdf/' })).toBe('pdf')
    const eff2 = lib.add({ sourceId: 'B', name: 'pdf', srcSkillDir: path.join(srcDir, 'b/pdf'), relPath: 'b/pdf/' })
    expect(eff2).toBe('pdf__B')
    expect(fs.existsSync(path.join(skillsDir, 'pdf__B', 'SKILL.md'))).toBe(true)
  })
  it('同源同名重复入库 = 幂等（返回已存在的 effectiveName）', () => {
    mkSkill(srcDir, 'pdf', 'pdf')
    const lib = makeLibrary(skillsDir)
    lib.add({ sourceId: 'A', name: 'pdf', srcSkillDir: path.join(srcDir, 'pdf'), relPath: 'pdf/' })
    expect(lib.add({ sourceId: 'A', name: 'pdf', srcSkillDir: path.join(srcDir, 'pdf'), relPath: 'pdf/' })).toBe('pdf')
  })
  it('移出 = 删目录 + 删 manifest', () => {
    mkSkill(srcDir, 'pdf', 'pdf')
    const lib = makeLibrary(skillsDir)
    lib.add({ sourceId: 'A', name: 'pdf', srcSkillDir: path.join(srcDir, 'pdf'), relPath: 'pdf/' })
    lib.remove('A', 'pdf/')
    expect(fs.existsSync(path.join(skillsDir, 'pdf'))).toBe(false)
    expect(lib.manifest()['pdf']).toBeUndefined()
  })
  it('isIn(sourceId, relPath) 判断是否已入库', () => {
    mkSkill(srcDir, 'pdf', 'pdf')
    const lib = makeLibrary(skillsDir)
    expect(lib.isIn('A', 'pdf/')).toBe(false)
    lib.add({ sourceId: 'A', name: 'pdf', srcSkillDir: path.join(srcDir, 'pdf'), relPath: 'pdf/' })
    expect(lib.isIn('A', 'pdf/')).toBe(true)
  })
  it('自指入库（源目录就是 skillsDir/<eff>）→ 不删源，记 manifest', () => {
    // 在 skillsDir 内直接造一个技能目录，再以它为 srcSkillDir 入库
    const inPlace = path.join(skillsDir, 'pdf'); fs.mkdirSync(inPlace, { recursive: true })
    fs.writeFileSync(path.join(inPlace, 'SKILL.md'), '---\nname: pdf\ndescription: d\n---\n')
    const lib = makeLibrary(skillsDir)
    const eff = lib.add({ sourceId: 'A', name: 'pdf', srcSkillDir: inPlace, relPath: 'pdf/' })
    expect(eff).toBe('pdf')
    expect(fs.existsSync(path.join(skillsDir, 'pdf', 'SKILL.md'))).toBe(true)   // 源未被删
    expect(lib.manifest()['pdf']).toMatchObject({ sourceId: 'A', name: 'pdf', relPath: 'pdf/' })
  })
})
