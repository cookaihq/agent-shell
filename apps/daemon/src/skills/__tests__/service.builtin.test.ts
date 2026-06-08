import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { makeSkillService } from '../service'

let skillsDir: string, sourcesFile: string, cacheRoot: string, builtinDir: string
beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-'))
  skillsDir = path.join(base, 'lib'); sourcesFile = path.join(base, 'src.json'); cacheRoot = path.join(base, 'cache')
  builtinDir = path.join(base, 'builtin-skills')
  fs.mkdirSync(skillsDir, { recursive: true }); fs.mkdirSync(cacheRoot, { recursive: true })
  const sk = path.join(builtinDir, 'install-skill'); fs.mkdirSync(sk, { recursive: true })
  fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: install-skill\nautoInject: true\n---\nv1')
})
const svc = () => makeSkillService(() => skillsDir, sourcesFile, cacheRoot)

describe('ensureBuiltinSource', () => {
  it('注册 builtin 源（固定 id）+ 内置 skill 入库（autoInject 种子 true）', () => {
    const s = svc(); s.ensureBuiltinSource(builtinDir)
    expect(s.listSources().find((x) => x.type === 'builtin')?.id).toBe('builtin')
    expect(s.listLibrary().find((x) => x.name === 'install-skill')?.autoInject).toBe(true)
  })
  it('幂等：连续两次只有一个 builtin 源', () => {
    const s = svc(); s.ensureBuiltinSource(builtinDir); s.ensureBuiltinSource(builtinDir)
    expect(s.listSources().filter((x) => x.type === 'builtin')).toHaveLength(1)
  })
  it('内容更新：改 builtin 目录 SKILL.md 后重跑 → 库内容更新', () => {
    const s = svc(); s.ensureBuiltinSource(builtinDir)
    fs.writeFileSync(path.join(builtinDir, 'install-skill', 'SKILL.md'), '---\nname: install-skill\nautoInject: true\n---\nv2')
    s.ensureBuiltinSource(builtinDir)
    expect(fs.readFileSync(path.join(skillsDir, 'install-skill', 'SKILL.md'), 'utf8')).toContain('v2')
  })
  it('保留用户 autoInject 开关：用户关掉后重跑不被种子覆盖', () => {
    const s = svc(); s.ensureBuiltinSource(builtinDir)
    s.setAutoInject('install-skill', false)
    s.ensureBuiltinSource(builtinDir)
    expect(s.listLibrary().find((x) => x.name === 'install-skill')?.autoInject).toBe(false)
  })
  it('removeSource(builtin) 抛 forbidden', () => {
    const s = svc(); s.ensureBuiltinSource(builtinDir)
    expect(() => s.removeSource('builtin')).toThrow()
  })
})
