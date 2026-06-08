import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
let server: DaemonServer, tmp: string
afterEach(async () => { await server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })

describe('POST /skills/install', () => {
  it('folder 源新技能 → installed + 入库', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-inst-'))
    const srcDir = path.join(tmp, 'foo'); fs.mkdirSync(srcDir, { recursive: true })
    fs.writeFileSync(path.join(srcDir, 'SKILL.md'), '---\nname: foo\n---\nhi')
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), skillsDir: path.join(tmp, 'skills') })
    const res = await fetch(`${server.url}/skills/install`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'folder', loc: srcDir }) })
    const body = await res.json() as { installed: Array<{ name: string }> }
    expect(body.installed.map((x) => x.name)).toEqual(['foo'])
    const { skills } = await (await fetch(`${server.url}/skill-library`)).json() as { skills: Array<{ name: string }> }
    expect(skills.find((s) => s.name === 'foo')).toBeTruthy()
  })
})
