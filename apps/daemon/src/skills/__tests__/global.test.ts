import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { detectGlobalEngines } from '../global'

let home: string
beforeEach(() => { home = fs.mkdtempSync(path.join(os.tmpdir(), 'home-')) })
afterEach(() => fs.rmSync(home, { recursive: true, force: true }))
const mk = (rel: string) => { const p = path.join(home, rel, 'SKILL.md'); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, '---\nname: x\n---\n') }

describe('detectGlobalEngines（覆盖预警）', () => {
  it('~/.claude/skills/<name> 存在 → claude', () => {
    mk('.claude/skills/pdf')
    expect(detectGlobalEngines('pdf', home)).toEqual(['claude'])
  })
  it('两个引擎都有 → [claude, codex]', () => {
    mk('.claude/skills/pdf'); mk('.codex/skills/pdf')
    expect(detectGlobalEngines('pdf', home)).toEqual(['claude', 'codex'])
  })
  it('都没有 → []', () => { expect(detectGlobalEngines('nope', home)).toEqual([]) })
})
