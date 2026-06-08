import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { makeSkillService } from '../service'

let skillsDir: string, sourcesFile: string, cacheRoot: string, base: string
beforeEach(() => {
  base = fs.mkdtempSync(path.join(os.tmpdir(), 'inst-'))
  skillsDir = path.join(base, 'lib'); sourcesFile = path.join(base, 'src.json'); cacheRoot = path.join(base, 'cache')
  fs.mkdirSync(skillsDir, { recursive: true }); fs.mkdirSync(cacheRoot, { recursive: true })
})
const svc = () => makeSkillService(() => skillsDir, sourcesFile, cacheRoot)
const mkSrc = (name: string, body: string) => {
  const d = path.join(base, 'srcs', name + '-' + Math.random().toString(36).slice(2, 6)); fs.mkdirSync(d, { recursive: true })
  fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${name}\n---\n${body}`); return d
}

describe('installSkill', () => {
  it('新技能 → installed', async () => {
    const s = svc(); const r = await s.installSkill({ type: 'folder', loc: mkSrc('foo', 'v1') })
    expect(r.installed.map((x) => x.name)).toEqual(['foo'])
    expect(s.listLibrary().find((x) => x.name === 'foo')).toBeTruthy()
  })
  it('同名同内容（指纹一致）再装 → already', async () => {
    const loc = mkSrc('foo', 'v1'); const s = svc()
    await s.installSkill({ type: 'folder', loc })
    const r = await s.installSkill({ type: 'folder', loc })
    expect(r.already.map((x) => x.name)).toEqual(['foo']); expect(r.installed).toEqual([])
  })
  it('同名异内容 → conflicts（不覆盖）', async () => {
    const s = svc()
    await s.installSkill({ type: 'folder', loc: mkSrc('foo', 'v1') })
    const r = await s.installSkill({ type: 'folder', loc: mkSrc('foo', 'DIFFERENT') })
    expect(r.conflicts.map((x) => x.name)).toEqual(['foo']); expect(r.installed).toEqual([])
  })
  it('全冲突 → 回滚源（不留孤儿）', async () => {
    const s = svc()
    await s.installSkill({ type: 'folder', loc: mkSrc('foo', 'v1') })
    const before = s.listSources().length
    await s.installSkill({ type: 'folder', loc: mkSrc('foo', 'DIFFERENT') })
    expect(s.listSources().length).toBe(before)
  })
})
