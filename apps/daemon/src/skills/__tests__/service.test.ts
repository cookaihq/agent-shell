import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { makeSkillService } from '../service'

let root: string, lib: string, srcFolder: string, sourcesFile: string, cacheRoot: string
const mkSkill = (base: string, rel: string, name: string) => {
  const p = path.join(base, rel); fs.mkdirSync(p, { recursive: true })
  fs.writeFileSync(path.join(p, 'SKILL.md'), `---\nname: ${name}\ndescription: ${name} desc\n---\n`)
}
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'))
  lib = path.join(root, 'lib'); srcFolder = path.join(root, 'src')
  sourcesFile = path.join(root, 'skill-sources.json'); cacheRoot = path.join(root, 'cache')
  mkSkill(srcFolder, 'pdf', 'pdf'); mkSkill(srcFolder, 'docx', 'docx')
})
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('skill service（folder 源端到端）', () => {
  const svc = () => makeSkillService(() => lib, sourcesFile, cacheRoot)
  it('addSource(folder) + probe 返回探测项，inLib=false', () => {
    const s = svc().addSource({ type: 'folder', name: 'local', loc: srcFolder, updateMode: 'manual' })
    const probed = svc().probe(s.id)
    expect(probed.map((p) => p.name).sort()).toEqual(['docx', 'pdf'])
    expect(probed.every((p) => p.inLib === false)).toBe(true)
  })
  it('toggleLib(inLib:true) → inLib 翻 true 且 listLibrary 含它（desc 从 materialized SKILL.md 读）', () => {
    const s = svc().addSource({ type: 'folder', name: 'local', loc: srcFolder, updateMode: 'manual' })
    svc().toggleLib(s.id, 'pdf/', true)
    expect(svc().probe(s.id).find((p) => p.relPath === 'pdf/')!.inLib).toBe(true)
    const list = svc().listLibrary()
    expect(list.map((l) => l.name)).toContain('pdf')
    expect(list.find((l) => l.name === 'pdf')!.desc).toBe('pdf desc')
  })
  it("setUpdateMode(id,'autolib') → 整源入库（两项都 inLib）", () => {
    const s = svc().addSource({ type: 'folder', name: 'local', loc: srcFolder, updateMode: 'manual' })
    svc().setUpdateMode(s.id, 'autolib')
    expect(svc().probe(s.id).every((p) => p.inLib)).toBe(true)
  })
  it('readSkillMd 返回探测技能的 SKILL.md 原文', () => {
    const s = svc().addSource({ type: 'folder', name: 'local', loc: srcFolder, updateMode: 'manual' })
    const md = svc().readSkillMd(s.id, 'pdf/')
    expect(md).toContain('name: pdf')
    expect(md).toContain('pdf desc')
  })
  it('readSkillMd 路径穿越 → 抛错', () => {
    const s = svc().addSource({ type: 'folder', name: 'local', loc: srcFolder, updateMode: 'manual' })
    expect(() => svc().readSkillMd(s.id, '../../etc/')).toThrow()
  })
  it('globalIn 按 effectiveName：重名消歧后 pdf__<id> 不误报全局覆盖', () => {
    const home = path.join(root, 'home')
    fs.mkdirSync(path.join(home, '.claude', 'skills', 'pdf'), { recursive: true })
    fs.writeFileSync(path.join(home, '.claude', 'skills', 'pdf', 'SKILL.md'), '---\nname: pdf\n---\n')
    const srcA = path.join(root, 'srcA'), srcB = path.join(root, 'srcB')
    mkSkill(srcA, 'pdf', 'pdf'); mkSkill(srcB, 'pdf', 'pdf')
    const svcH = () => makeSkillService(() => lib, sourcesFile, cacheRoot, home)
    const a = svcH().addSource({ type: 'folder', name: 'A', loc: srcA, updateMode: 'manual' })
    const b = svcH().addSource({ type: 'folder', name: 'B', loc: srcB, updateMode: 'manual' })
    svcH().toggleLib(a.id, 'pdf/', true)
    svcH().toggleLib(b.id, 'pdf/', true)
    const list = svcH().listLibrary()
    const byEff = Object.fromEntries(list.map((l) => [l.effectiveName, l]))
    // 第二个源因重名消歧，effectiveName = pdf__<b.id>（非 pdf）
    const dedupedEff = `pdf__${b.id}`
    expect(byEff['pdf'].globalIn).toEqual(['claude'])     // 注入名 pdf 撞全局 → 预警
    expect(byEff[dedupedEff].globalIn).toEqual([])         // 注入名 pdf__<id> 不撞 → 不预警
  })
})
