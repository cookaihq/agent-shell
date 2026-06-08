import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { openDatabase } from '../../db/database'
import { createProjectWithSkills, defaultInjectSet } from '../createWithSkills'
import { makeLibrary } from '../../skills/library'

let db: Database.Database, projectsDir: string, skillsDir: string
beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'cpw-'))
  projectsDir = path.join(base, 'projects'); skillsDir = path.join(base, 'skills')
  fs.mkdirSync(projectsDir, { recursive: true }); fs.mkdirSync(skillsDir, { recursive: true })
  db = openDatabase(':memory:')   // 走 initSchema，schema 永远跟真实建表同步（不再手写 DDL，避免漂移）
  for (const [n, ai] of [['auto', true], ['manual', false]] as const) {
    const d = path.join(skillsDir, n); fs.mkdirSync(d)
    fs.writeFileSync(path.join(d, 'SKILL.md'), `---\nname: ${n}\nautoInject: ${ai}\n---`)
    makeLibrary(skillsDir).add({ sourceId: 's', name: n, srcSkillDir: d, relPath: `${n}/` })
  }
})
const injected = (projPath: string) => {
  try { return fs.readdirSync(path.join(projPath, '.claude', 'skills')).sort() } catch { return [] }
}

describe('createProjectWithSkills', () => {
  it('defaultInjectSet = manifest 中 autoInject 的 effectiveName', () => {
    expect(defaultInjectSet(skillsDir)).toEqual(['auto'])
  })
  it('explicitSkills 数组 → 照单注入', () => {
    const p = createProjectWithSkills({ db, projectsDir, skillsDir }, 'P', ['manual'])
    expect(injected(p.path)).toEqual(['manual'])
  })
  it('省略 explicitSkills → 注入默认集', () => {
    const p = createProjectWithSkills({ db, projectsDir, skillsDir }, 'P')
    expect(injected(p.path)).toEqual(['auto'])
  })
  it('explicitSkills=[] → 不注入任何', () => {
    const p = createProjectWithSkills({ db, projectsDir, skillsDir }, 'P', [])
    expect(injected(p.path)).toEqual([])
  })
  it('落 DB 行', () => {
    const p = createProjectWithSkills({ db, projectsDir, skillsDir }, 'P', [])
    expect(db.prepare('SELECT name FROM projects WHERE id=?').get(p.id)).toEqual({ name: 'P' })
  })
})
