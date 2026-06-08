import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { listInjectedSkills } from '../injected'

let proj: string
beforeEach(() => { proj = fs.mkdtempSync(path.join(os.tmpdir(), 'proj-')) })

describe('listInjectedSkills', () => {
  it('无 .claude/skills → 空', () => {
    expect(listInjectedSkills(proj)).toEqual([])
  })
  it('列出 .claude/skills 下的目录与软链名（排序）', () => {
    const dir = path.join(proj, '.claude', 'skills')
    fs.mkdirSync(dir, { recursive: true })
    fs.mkdirSync(path.join(dir, 'guizang-ppt'))
    const real = fs.mkdtempSync(path.join(os.tmpdir(), 'real-'))
    fs.symlinkSync(real, path.join(dir, 'gaode-map'), 'dir')
    expect(listInjectedSkills(proj)).toEqual(['gaode-map', 'guizang-ppt'])
  })
})
