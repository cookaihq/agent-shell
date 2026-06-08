import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { materializeSkillFiles } from '../materializeFiles'
import type { EntityRequirement } from '@agent-shell/contracts'

let skillsDir: string, ext: string
beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'mat-'))
  skillsDir = path.join(base, 'lib'); ext = path.join(base, 'ext')
  fs.mkdirSync(path.join(skillsDir, 'gaode'), { recursive: true })
  fs.mkdirSync(ext, { recursive: true })
})
const reqs = (m: Record<string, EntityRequirement>) => ({ get: (r: string) => m[r] })
const secrets = (m: Record<string, string>) => ({ getValue: (id: string) => m[id] })

describe('materializeSkillFiles', () => {
  it('in-folder：把 secret 值写进库目录 <eff>/<目标>', () => {
    const r = materializeSkillFiles(
      ['skill:gaode'],
      reqs({ 'skill:gaode': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'file', name: 'config/key.txt', fileMode: 'in-folder', bind: 'k1', optional: false }] } }),
      secrets({ k1: 'SECRET-CONTENT' }),
      skillsDir,
    )
    expect(fs.readFileSync(path.join(skillsDir, 'gaode', 'config', 'key.txt'), 'utf8')).toBe('SECRET-CONTENT')
    expect(r.errors).toEqual([])
  })
  it('in-folder：无 bind 用 default 作内容', () => {
    materializeSkillFiles(
      ['skill:gaode'],
      reqs({ 'skill:gaode': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'file', name: 'd.txt', fileMode: 'in-folder', bind: null, default: 'DEF', optional: false }] } }),
      secrets({}),
      skillsDir,
    )
    expect(fs.readFileSync(path.join(skillsDir, 'gaode', 'd.txt'), 'utf8')).toBe('DEF')
  })
  it('external-path：目标不存在 → 写文件', () => {
    const target = path.join(ext, 'creds')
    const r = materializeSkillFiles(
      ['skill:gaode'],
      reqs({ 'skill:gaode': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'file', name: target, fileMode: 'external-path', bind: 'k1', optional: false }] } }),
      secrets({ k1: 'CRED-CONTENT' }),
      skillsDir,
    )
    expect(fs.existsSync(target)).toBe(true)
    expect(fs.readFileSync(target, 'utf8')).toBe('CRED-CONTENT')
    expect(r.errors).toEqual([])
  })
  it('external-path：目标已存在真实文件 → 拒绝 + 记 error，不覆盖', () => {
    const target = path.join(ext, 'creds')
    fs.writeFileSync(target, 'ORIGINAL')
    const r = materializeSkillFiles(
      ['skill:gaode'],
      reqs({ 'skill:gaode': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'file', name: target, fileMode: 'external-path', bind: 'k1', optional: false }] } }),
      secrets({ k1: 'NEW' }),
      skillsDir,
    )
    expect(fs.readFileSync(target, 'utf8')).toBe('ORIGINAL')
    expect(r.errors.length).toBe(1)
  })
  it('env 槽位忽略；未精确探测（无 slots）忽略', () => {
    const r = materializeSkillFiles(
      ['skill:a', 'skill:b'],
      reqs({
        'skill:a': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'K', bind: 'k1', optional: false }] },
        'skill:b': { needsConfig: true, slotsSource: null },
      }),
      secrets({ k1: 'v' }),
      skillsDir,
    )
    expect(r.errors).toEqual([])
  })
  it('in-folder：slot.name 含 ../ 穿越 → 拒绝 + 记 error，不写出库目录', () => {
    const r = materializeSkillFiles(
      ['skill:gaode'],
      reqs({ 'skill:gaode': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'file', name: '../escape.txt', fileMode: 'in-folder', bind: 'k1', optional: false }] } }),
      secrets({ k1: 'X' }),
      skillsDir,
    )
    expect(fs.existsSync(path.join(skillsDir, 'escape.txt'))).toBe(false)
    expect(r.errors).toEqual([{ entityRef: 'skill:gaode', target: '../escape.txt', reason: 'path_escape' }])
  })
})
