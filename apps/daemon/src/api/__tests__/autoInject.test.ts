import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { libraryManifestPath } from '../../paths'

let server: DaemonServer, tmp: string
afterEach(async () => { await server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })
const J = { 'content-type': 'application/json' }

describe('autoInject', () => {
  it('setAutoInject → listLibrary 反映 + 建项目(无 skills)注入默认集', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-ai-'))
    const skillsDir = path.join(tmp, 'skills'); fs.mkdirSync(skillsDir, { recursive: true })
    const d = path.join(skillsDir, 'foo'); fs.mkdirSync(d); fs.writeFileSync(path.join(d, 'SKILL.md'), '---\nname: foo\n---')
    // 入库：直接写 manifest（模拟已 toggleLib）
    fs.writeFileSync(libraryManifestPath(skillsDir), JSON.stringify({ foo: { sourceId: 's', name: 'foo', relPath: 'foo/' } }))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), skillsDir, projectsDir: path.join(tmp, 'projects') })

    // 默认未开 autoInject → 建项目(无 skills) 不注入
    let res = await fetch(`${server.url}/api/projects`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'P1' }) })
    const p1 = (await res.json() as { path: string }).path
    expect(fs.existsSync(path.join(p1, '.claude', 'skills', 'foo'))).toBe(false)

    // 开 autoInject
    await fetch(`${server.url}/api/skill-library/auto-inject`, { method: 'POST', headers: J, body: JSON.stringify({ effectiveName: 'foo', on: true }) })
    const lib = await (await fetch(`${server.url}/api/skill-library`)).json() as { skills: Array<{ effectiveName: string; autoInject: boolean }> }
    expect(lib.skills.find(s => s.effectiveName === 'foo')?.autoInject).toBe(true)

    // 建项目(无 skills) → 注入默认集 foo
    res = await fetch(`${server.url}/api/projects`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'P2' }) })
    const p2 = (await res.json() as { path: string }).path
    expect(fs.existsSync(path.join(p2, '.claude', 'skills', 'foo'))).toBe(true)

    // 显式传 skills=[] → 不注入（即使有默认集）
    res = await fetch(`${server.url}/api/projects`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'P3', skills: [] }) })
    const p3 = (await res.json() as { path: string }).path
    expect(fs.existsSync(path.join(p3, '.claude', 'skills', 'foo'))).toBe(false)
  })
})
