import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'

let server: DaemonServer, tmp: string
afterEach(async () => { await server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })
const J = { 'content-type': 'application/json' }

describe('/skill-groups routes', () => {
  it('GET /skill-groups → 200, returns array (includes created singleton)', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sg-'))
    const skillsDir = path.join(tmp, 'skills'); fs.mkdirSync(skillsDir, { recursive: true })
    const skillGroupsPath = path.join(tmp, 'skill-groups.json')
    const skillSourcesPath = path.join(tmp, 'skill-sources.json')
    const createdSkillsDir = path.join(tmp, 'created'); fs.mkdirSync(createdSkillsDir, { recursive: true })
    server = await startDaemon({
      detect: () => ({ claude: '/x', codex: '/x' }),
      skillsDir,
      projectsDir: path.join(tmp, 'projects'),
      skillSourcesPath,
      skillGroupsPath,
      createdSkillsDir,
    })

    const res = await fetch(`${server.url}/api/skill-groups`)
    expect(res.status).toBe(200)
    const body = await res.json() as { groups: unknown[] }
    expect(Array.isArray(body.groups)).toBe(true)
    // After migration, the 'created' singleton group should exist
    expect(body.groups.length).toBeGreaterThanOrEqual(1)
  })

  it('POST /skill-groups → 201, returns group with g_ id', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sg-'))
    const skillsDir = path.join(tmp, 'skills'); fs.mkdirSync(skillsDir, { recursive: true })
    const skillGroupsPath = path.join(tmp, 'skill-groups.json')
    const skillSourcesPath = path.join(tmp, 'skill-sources.json')
    const createdSkillsDir = path.join(tmp, 'created'); fs.mkdirSync(createdSkillsDir, { recursive: true })
    server = await startDaemon({
      detect: () => ({ claude: '/x', codex: '/x' }),
      skillsDir,
      projectsDir: path.join(tmp, 'projects'),
      skillSourcesPath,
      skillGroupsPath,
      createdSkillsDir,
    })

    const res = await fetch(`${server.url}/api/skill-groups`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: '新组' }),
    })
    expect(res.status).toBe(201)
    const body = await res.json() as { group: { id: string; name: string; sortIndex: number } }
    expect(body.group).toBeDefined()
    expect(body.group.id).toMatch(/^g_/)
    expect(body.group.name).toBe('新组')
    expect(typeof body.group.sortIndex).toBe('number')
  })

  it('PATCH /skill-groups/:id → 200, updates name', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sg-'))
    const skillsDir = path.join(tmp, 'skills'); fs.mkdirSync(skillsDir, { recursive: true })
    const skillGroupsPath = path.join(tmp, 'skill-groups.json')
    const skillSourcesPath = path.join(tmp, 'skill-sources.json')
    const createdSkillsDir = path.join(tmp, 'created'); fs.mkdirSync(createdSkillsDir, { recursive: true })
    server = await startDaemon({
      detect: () => ({ claude: '/x', codex: '/x' }),
      skillsDir,
      projectsDir: path.join(tmp, 'projects'),
      skillSourcesPath,
      skillGroupsPath,
      createdSkillsDir,
    })

    // Create a group first
    const createRes = await fetch(`${server.url}/api/skill-groups`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: '原始名' }),
    })
    const created = await createRes.json() as { group: { id: string } }
    const groupId = created.group.id

    // Patch it
    const res = await fetch(`${server.url}/api/skill-groups/${groupId}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ name: '改名' }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { group: { id: string; name: string } }
    expect(body.group.id).toBe(groupId)
    expect(body.group.name).toBe('改名')
  })

  it('POST /skill-groups/reorder → 200 {ok:true}', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sg-'))
    const skillsDir = path.join(tmp, 'skills'); fs.mkdirSync(skillsDir, { recursive: true })
    const skillGroupsPath = path.join(tmp, 'skill-groups.json')
    const skillSourcesPath = path.join(tmp, 'skill-sources.json')
    const createdSkillsDir = path.join(tmp, 'created'); fs.mkdirSync(createdSkillsDir, { recursive: true })
    server = await startDaemon({
      detect: () => ({ claude: '/x', codex: '/x' }),
      skillsDir,
      projectsDir: path.join(tmp, 'projects'),
      skillSourcesPath,
      skillGroupsPath,
      createdSkillsDir,
    })

    // Create two groups so we have something to reorder
    const r1 = await fetch(`${server.url}/api/skill-groups`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'A' }) })
    const g1 = (await r1.json() as { group: { id: string } }).group
    const r2 = await fetch(`${server.url}/api/skill-groups`, { method: 'POST', headers: J, body: JSON.stringify({ name: 'B' }) })
    const g2 = (await r2.json() as { group: { id: string } }).group

    const res = await fetch(`${server.url}/api/skill-groups/reorder`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ order: [g2.id, g1.id] }),
    })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })

  it('DELETE /skill-groups/created → 403 (system singleton)', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sg-'))
    const skillsDir = path.join(tmp, 'skills'); fs.mkdirSync(skillsDir, { recursive: true })
    const skillGroupsPath = path.join(tmp, 'skill-groups.json')
    const skillSourcesPath = path.join(tmp, 'skill-sources.json')
    const createdSkillsDir = path.join(tmp, 'created'); fs.mkdirSync(createdSkillsDir, { recursive: true })
    server = await startDaemon({
      detect: () => ({ claude: '/x', codex: '/x' }),
      skillsDir,
      projectsDir: path.join(tmp, 'projects'),
      skillSourcesPath,
      skillGroupsPath,
      createdSkillsDir,
    })

    const res = await fetch(`${server.url}/api/skill-groups/created`, { method: 'DELETE' })
    expect(res.status).toBe(403)
  })

  it('DELETE /skill-groups/:id → 200 (user group)', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-sg-'))
    const skillsDir = path.join(tmp, 'skills'); fs.mkdirSync(skillsDir, { recursive: true })
    const skillGroupsPath = path.join(tmp, 'skill-groups.json')
    const skillSourcesPath = path.join(tmp, 'skill-sources.json')
    const createdSkillsDir = path.join(tmp, 'created'); fs.mkdirSync(createdSkillsDir, { recursive: true })
    server = await startDaemon({
      detect: () => ({ claude: '/x', codex: '/x' }),
      skillsDir,
      projectsDir: path.join(tmp, 'projects'),
      skillSourcesPath,
      skillGroupsPath,
      createdSkillsDir,
    })

    // Create a user group
    const createRes = await fetch(`${server.url}/api/skill-groups`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: '待删除分组' }),
    })
    const created = await createRes.json() as { group: { id: string } }
    const groupId = created.group.id

    // Delete it
    const res = await fetch(`${server.url}/api/skill-groups/${groupId}`, { method: 'DELETE' })
    expect(res.status).toBe(200)
    const body = await res.json() as { ok: boolean }
    expect(body.ok).toBe(true)
  })
})
