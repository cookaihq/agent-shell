import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'

let server: DaemonServer, tmp: string
afterEach(async () => { await server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })

describe('GET /skills', () => {
  it('扫描 skillsDir 返回技能列表', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sk-'))
    fs.mkdirSync(path.join(tmp, 'brand-asset'))
    fs.writeFileSync(path.join(tmp, 'brand-asset', 'SKILL.md'), '---\nname: brand-asset\ndescription: 品牌资产\n---')
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), skillsDir: tmp })
    const res = await fetch(`${server.url}/skills`)
    const { skills } = await res.json() as { skills: Array<{ name: string; source: string; origin: string; desc: string }> }
    expect(skills).toEqual([{ name: 'brand-asset', source: 'folder', origin: '', desc: '品牌资产' }])
  })
})

describe('skills 导入/删除', () => {
  it('POST /skills/import folder（真实复制）+ DELETE', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sk-'))
    const lib = path.join(tmp, 'lib'); const src = path.join(tmp, 'src-skill')
    fs.mkdirSync(src, { recursive: true }); fs.writeFileSync(path.join(src, 'SKILL.md'), '---\nname: src-skill\ndescription: 来自文件夹\n---')
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), skillsDir: lib })
    const r1 = await fetch(`${server.url}/skills/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'folder', path: src }) })
    expect(r1.status).toBe(201)
    expect((await r1.json() as { skill: { name: string; source: string; desc: string } }).skill).toMatchObject({ name: 'src-skill', source: 'folder', desc: '来自文件夹' })
    const r2 = await fetch(`${server.url}/skills/src-skill`, { method: 'DELETE' })
    expect(r2.status).toBe(200)
    const r3 = await fetch(`${server.url}/skills`); expect((await r3.json() as { skills: unknown[] }).skills).toEqual([])
  })
  it('folder 缺 SKILL.md → 400 no_skill_md', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sk2-'))
    const bad = path.join(tmp, 'bad'); fs.mkdirSync(bad, { recursive: true })
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), skillsDir: path.join(tmp, 'lib') })
    const r = await fetch(`${server.url}/skills/import`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ source: 'folder', path: bad }) })
    expect(r.status).toBe(400); expect((await r.json() as { error: { code: string } }).error.code).toBe('no_skill_md')
  })
})
