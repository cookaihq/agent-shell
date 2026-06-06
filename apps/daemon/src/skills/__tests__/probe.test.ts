import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { probeSkills } from '../probe'

let root: string
const mk = (rel: string, body = '---\nname: x\ndescription: d\n---\n') => {
  const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, body)
}
beforeEach(() => { root = fs.mkdtempSync(path.join(os.tmpdir(), 'probe-')) })
afterEach(() => fs.rmSync(root, { recursive: true, force: true }))

describe('probeSkills (spec §4)', () => {
  it('根有 SKILL.md → 整个目录算 1 个，不再下钻', () => {
    mk('SKILL.md', '---\nname: root-skill\ndescription: rd\n---\n'); mk('sub/SKILL.md')
    const r = probeSkills(root)
    expect(r.map(s => s.relPath)).toEqual([''])      // 根目录本身 = 1 个技能
    expect(r[0].name).toBe('root-skill')
  })
  it('根无 SKILL.md → 递归找含 SKILL.md 的目录，每条路径遇第一个即停', () => {
    mk('document-skills/pdf/SKILL.md', '---\nname: pdf\ndescription: PDF\n---\n')
    mk('document-skills/docx/SKILL.md')
    mk('document-skills/pdf/deep/SKILL.md')           // pdf 已是技能 → 不再进它内部
    mk('mcp-builder/SKILL.md')
    const names = probeSkills(root).map(s => s.relPath).sort()
    expect(names).toEqual(['document-skills/docx/', 'document-skills/pdf/', 'mcp-builder/'])
  })
  it('解析 frontmatter name/desc；缺 name 用目录名兜底', () => {
    mk('no-name/SKILL.md', '---\ndescription: only desc\n---\n')
    const r = probeSkills(root).find(s => s.relPath === 'no-name/')!
    expect(r.name).toBe('no-name'); expect(r.desc).toBe('only desc')
  })
})
