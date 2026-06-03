import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { injectClaudeSkills } from '../inject'

let root: string, lib: string, proj: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'as-inj-'))
  lib = path.join(root, 'lib'); proj = path.join(root, 'proj')
  fs.mkdirSync(proj, { recursive: true })
  for (const n of ['guizang-ppt', 'brand-asset']) {
    fs.mkdirSync(path.join(lib, n), { recursive: true })
    fs.writeFileSync(path.join(lib, n, 'SKILL.md'), `---\nname: ${n}\ndescription: d\n---`)
  }
})
afterEach(() => { fs.rmSync(root, { recursive: true, force: true }) })

describe('injectClaudeSkills', () => {
  it('软链选中技能进 <project>/.claude/skills，可经链读到 SKILL.md', () => {
    injectClaudeSkills(proj, lib, ['guizang-ppt'])
    const link = path.join(proj, '.claude', 'skills', 'guizang-ppt')
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8')).toContain('name: guizang-ppt')
  })
  it('空 names → 不建 .claude 目录', () => {
    injectClaudeSkills(proj, lib, [])
    expect(fs.existsSync(path.join(proj, '.claude'))).toBe(false)
  })
  it('库中不存在的技能名 → 跳过不抛', () => {
    injectClaudeSkills(proj, lib, ['nope', 'brand-asset'])
    expect(fs.existsSync(path.join(proj, '.claude', 'skills', 'nope'))).toBe(false)
    expect(fs.existsSync(path.join(proj, '.claude', 'skills', 'brand-asset'))).toBe(true)
  })
})
