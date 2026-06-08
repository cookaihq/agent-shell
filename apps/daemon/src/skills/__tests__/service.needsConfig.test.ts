import { describe, it, expect, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { makeSkillService } from '../service'
import { makeEntityRequirementStore } from '../entityRequirements'

let srcDir: string, skillsDir: string, sourcesFile: string, cacheRoot: string, reqFile: string
beforeEach(() => {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'svc-'))
  srcDir = path.join(base, 'src'); skillsDir = path.join(base, 'lib')
  sourcesFile = path.join(base, 'sources.json'); cacheRoot = path.join(base, 'cache')
  reqFile = path.join(base, 'req.json')
  fs.mkdirSync(srcDir, { recursive: true }); fs.mkdirSync(skillsDir, { recursive: true })
  const a = path.join(srcDir, 'gaode'); fs.mkdirSync(a)
  fs.writeFileSync(path.join(a, 'SKILL.md'), '---\nname: gaode\n---\n设置 GAODE_API_KEY')
  const b = path.join(srcDir, 'upper'); fs.mkdirSync(b)
  fs.writeFileSync(path.join(b, 'SKILL.md'), '---\nname: upper\n---\n转大写，无需密钥')
})

describe('service needsConfig', () => {
  it('probe：挂 needsConfig（gaode=true / upper=false）', () => {
    const svc = makeSkillService(() => skillsDir, sourcesFile, cacheRoot, os.homedir())
    const src = svc.addSource({ type: 'folder', name: 'local', loc: srcDir, updateMode: 'manual' })
    const probed = svc.probe(src.id)
    const byName = Object.fromEntries(probed.map((p) => [p.name, p.needsConfig]))
    expect(byName.gaode).toBe(true)
    expect(byName.upper).toBe(false)
  })
  it('listLibrary：库内技能挂 needsConfig 且持久化进 entity-requirements', () => {
    const reqs = makeEntityRequirementStore(reqFile)
    const svc = makeSkillService(() => skillsDir, sourcesFile, cacheRoot, os.homedir(), reqs)
    const src = svc.addSource({ type: 'folder', name: 'local', loc: srcDir, updateMode: 'manual' })
    const p = svc.probe(src.id).find((x) => x.name === 'gaode')!
    svc.toggleLib(src.id, p.relPath, true)
    const lib = svc.listLibrary()
    const entry = lib.find((x) => x.name === 'gaode')!
    expect(entry.needsConfig).toBe(true)
    expect(reqs.get('skill:' + entry.effectiveName)?.needsConfig).toBe(true)
  })
})
