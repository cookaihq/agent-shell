import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { makeSkillService } from '../service'

let skillsDir: string, sourcesFile: string, cacheRoot: string, createdDir: string
beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'crt-'))
  skillsDir = path.join(base, 'lib'); sourcesFile = path.join(base, 'src.json'); cacheRoot = path.join(base, 'cache'); createdDir = path.join(base, 'created')
  fs.mkdirSync(skillsDir, { recursive: true }); fs.mkdirSync(cacheRoot, { recursive: true })
})
const svc = () => makeSkillService(() => skillsDir, sourcesFile, cacheRoot, os.homedir(), undefined, createdDir)

describe('createSkill', () => {
  it('新建 → status created + 写 created-skills + 入库（autoInject 不开）', () => {
    const s = svc()
    const r = s.createSkill({ name: 'my-skill', description: '我的技能', body: '步骤一二三' })
    expect(r.status).toBe('created'); expect(r.effectiveName).toBe('my-skill')
    expect(fs.readFileSync(path.join(createdDir, 'my-skill', 'SKILL.md'), 'utf8')).toContain('步骤一二三')
    const lib = s.listLibrary().find((x) => x.name === 'my-skill')
    expect(lib).toBeTruthy(); expect(lib?.autoInject).toBe(false)
  })
  it('frontmatter 含 name/description、不含 autoInject', () => {
    const s = svc(); s.createSkill({ name: 'foo', description: 'desc', body: 'b' })
    const md = fs.readFileSync(path.join(createdDir, 'foo', 'SKILL.md'), 'utf8')
    expect(md).toContain('name: foo'); expect(md).toContain('description: desc'); expect(md).not.toContain('autoInject')
  })
  it('撞名（库内已有同名）→ status conflict，不覆盖', () => {
    const s = svc()
    s.createSkill({ name: 'foo', description: 'd1', body: 'v1' })
    const r = s.createSkill({ name: 'foo', description: 'd2', body: 'v2' })
    expect(r.status).toBe('conflict'); expect(r.existingEffectiveName).toBe('foo')
    expect(fs.readFileSync(path.join(createdDir, 'foo', 'SKILL.md'), 'utf8')).toContain('v1')
  })
  it('ensureCreatedSource：注册「我创建的」folder 源（id=created）', () => {
    const s = svc(); s.ensureCreatedSource()
    const src = s.listSources().find((x) => x.id === 'created')
    expect(src?.type).toBe('folder'); expect(src?.name).toBe('我创建的')
  })
  it('createSkill 后 listLibrary 该项 sourceName=我创建的', () => {
    const s = svc(); s.createSkill({ name: 'foo', description: 'd', body: 'b' })
    expect(s.listLibrary().find((x) => x.name === 'foo')?.sourceName).toBe('我创建的')
  })
})
