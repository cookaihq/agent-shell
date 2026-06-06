import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'
import { openDatabase } from '../../db/database'

let server: DaemonServer | null = null
let tmp: string
let skillsDir: string

afterEach(async () => {
  if (server) await server.close(); server = null
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
  if (skillsDir) fs.rmSync(skillsDir, { recursive: true, force: true })
})

function startWith(db = openDatabase(':memory:')) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-inj-route-proj-'))
  skillsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-inj-route-lib-'))
  for (const n of ['guizang-ppt', 'brand-asset']) {
    fs.mkdirSync(path.join(skillsDir, n), { recursive: true })
    fs.writeFileSync(path.join(skillsDir, n, 'SKILL.md'), `---\nname: ${n}\ndescription: d\n---`)
  }
  return startDaemon({ detect: () => ({ claude: '/x/claude', codex: '/x/codex' }), db, projectsDir: tmp, skillsDir })
}

async function createProject(url: string, name = 'P'): Promise<{ projectId: string; path: string }> {
  const res = await fetch(url + '/projects', {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name }),
  })
  return res.json() as Promise<{ projectId: string; path: string }>
}

describe('POST /projects/:id/inject-skills', () => {
  it('对已存在项目注入：软链选中技能进 <project>/.claude/skills，经链可读 SKILL.md', async () => {
    server = await startWith()
    const { projectId, path: projPath } = await createProject(server.url)
    const res = await fetch(server.url + `/projects/${projectId}/inject-skills`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skills: ['guizang-ppt'] }),
    })
    expect(res.status).toBe(200)
    expect((await res.json() as { ok: boolean }).ok).toBe(true)
    const link = path.join(projPath, '.claude', 'skills', 'guizang-ppt')
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true)
    expect(fs.readFileSync(path.join(link, 'SKILL.md'), 'utf8')).toContain('name: guizang-ppt')
  })

  it('幂等：重复注入同一技能不抛，链接仍在', async () => {
    server = await startWith()
    const { projectId, path: projPath } = await createProject(server.url)
    const inject = () => fetch(server!.url + `/projects/${projectId}/inject-skills`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skills: ['guizang-ppt'] }),
    })
    expect((await inject()).status).toBe(200)
    expect((await inject()).status).toBe(200)
    expect(fs.existsSync(path.join(projPath, '.claude', 'skills', 'guizang-ppt'))).toBe(true)
  })

  it('库中不存在的技能名跳过，存在的仍注入', async () => {
    server = await startWith()
    const { projectId, path: projPath } = await createProject(server.url)
    const res = await fetch(server.url + `/projects/${projectId}/inject-skills`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skills: ['nope', 'brand-asset'] }),
    })
    expect(res.status).toBe(200)
    expect(fs.existsSync(path.join(projPath, '.claude', 'skills', 'nope'))).toBe(false)
    expect(fs.existsSync(path.join(projPath, '.claude', 'skills', 'brand-asset'))).toBe(true)
  })

  it('项目不存在 → 404 not_found', async () => {
    server = await startWith()
    const res = await fetch(server.url + '/projects/nope/inject-skills', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skills: ['guizang-ppt'] }),
    })
    expect(res.status).toBe(404)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('not_found')
  })

  it('请求体非法（skills 非数组）→ 400 invalid_request', async () => {
    server = await startWith()
    const { projectId } = await createProject(server.url)
    const res = await fetch(server.url + `/projects/${projectId}/inject-skills`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ skills: 'x' }),
    })
    expect(res.status).toBe(400)
    expect((await res.json() as { error: { code: string } }).error.code).toBe('invalid_request')
  })
})
