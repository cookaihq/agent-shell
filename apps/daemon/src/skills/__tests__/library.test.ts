import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { createHash } from 'node:crypto'
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

describe('library autoInject seed + fingerprint + setAutoInject', () => {
  it('add 写入 fingerprint（SKILL.md 内容 hash）', () => {
    const skillMd = '---\nname: a\ndescription: d\n---\n'
    const p = path.join(srcDir, 'a'); fs.mkdirSync(p, { recursive: true })
    fs.writeFileSync(path.join(p, 'SKILL.md'), skillMd)
    const lib = makeLibrary(skillsDir)
    lib.add({ sourceId: 's', name: 'a', srcSkillDir: p, relPath: 'a/' })
    const expected = createHash('sha256').update(Buffer.from(skillMd)).digest('hex')
    expect(lib.manifest()['a'].fingerprint).toBe(expected)
  })
  it('add 新建条目取 frontmatter autoInject 种子', () => {
    const skillMd = '---\nname: a\ndescription: d\nautoInject: true\n---\n'
    const p = path.join(srcDir, 'a'); fs.mkdirSync(p, { recursive: true })
    fs.writeFileSync(path.join(p, 'SKILL.md'), skillMd)
    const lib = makeLibrary(skillsDir)
    lib.add({ sourceId: 's', name: 'a', srcSkillDir: p, relPath: 'a/' })
    expect(lib.manifest()['a'].autoInject).toBe(true)
  })
  it('add 幂等不覆盖用户已改的 autoInject', () => {
    const skillMd = '---\nname: a\ndescription: d\nautoInject: true\n---\n'
    const p = path.join(srcDir, 'a'); fs.mkdirSync(p, { recursive: true })
    fs.writeFileSync(path.join(p, 'SKILL.md'), skillMd)
    const lib = makeLibrary(skillsDir)
    lib.add({ sourceId: 's', name: 'a', srcSkillDir: p, relPath: 'a/' })
    lib.setAutoInject('a', false)
    lib.add({ sourceId: 's', name: 'a', srcSkillDir: p, relPath: 'a/' })  // 幂等，不覆盖
    expect(lib.manifest()['a'].autoInject).toBe(false)
  })
  it('setAutoInject 改开关 + 不存在的 eff 无副作用', () => {
    mkSkill(srcDir, 'a', 'a')
    const lib = makeLibrary(skillsDir)
    lib.add({ sourceId: 's', name: 'a', srcSkillDir: path.join(srcDir, 'a'), relPath: 'a/' })
    lib.setAutoInject('a', true)
    expect(lib.manifest()['a'].autoInject).toBe(true)
    lib.setAutoInject('nope', true)  // 不存在，无副作用，无抛
    expect(lib.manifest()['nope']).toBeUndefined()
  })
})
