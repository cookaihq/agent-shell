import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
let server: DaemonServer, tmp: string
afterEach(async () => { await server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })
const J = { 'content-type': 'application/json' }

describe('POST /skills/create', () => {
  it('创建 → created + 入库', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-crt-'))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), skillsDir: path.join(tmp, 'skills'), createdSkillsDir: path.join(tmp, 'created') })
    const res = await fetch(`${server.url}/skills/create`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'foo', description: 'd', body: 'b' }) })
    const body = await res.json() as { status: string; effectiveName: string }
    expect(body.status).toBe('created'); expect(body.effectiveName).toBe('foo')
    const { skills } = await (await fetch(`${server.url}/skill-library`)).json() as { skills: Array<{ name: string }> }
    expect(skills.find((s) => s.name === 'foo')).toBeTruthy()
  })
  it('撞名 → conflict', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-crt2-'))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), skillsDir: path.join(tmp, 'skills'), createdSkillsDir: path.join(tmp, 'created') })
    await fetch(`${server.url}/skills/create`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'foo', description: 'd', body: 'b1' }) })
    const res = await fetch(`${server.url}/skills/create`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'foo', description: 'd', body: 'b2' }) })
    expect((await res.json() as { status: string }).status).toBe('conflict')
  })
})
