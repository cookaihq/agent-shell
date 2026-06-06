import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'

let server: DaemonServer, tmp: string
afterEach(async () => { await server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })

const start = async () => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-src-'))
  const srcFolder = path.join(tmp, 'src')
  for (const [d, name, desc] of [['pdf', 'pdf', 'PDF 工具'], ['docx', 'docx', 'DOCX']] as const) {
    fs.mkdirSync(path.join(srcFolder, d), { recursive: true })
    fs.writeFileSync(path.join(srcFolder, d, 'SKILL.md'), `---\nname: ${name}\ndescription: ${desc}\n---\n`)
  }
  server = await startDaemon({
    detect: () => ({ claude: '/x', codex: '/x' }),
    skillsDir: path.join(tmp, 'lib'),
    skillSourcesPath: path.join(tmp, 'skill-sources.json'),
    skillSrcCacheDir: path.join(tmp, 'cache'),
  })
  return { srcFolder }
}
const addFolder = async (loc: string) => {
  const r = await fetch(`${server.url}/skill-sources`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ type: 'folder', name: 'local', loc, updateMode: 'manual' }) })
  return r
}

describe('技能源端点', () => {
  it('POST /skill-sources(folder) → 201；GET /skill-sources/:id/skills 含探测项 inLib=false', async () => {
    const { srcFolder } = await start()
    const r1 = await addFolder(srcFolder)
    expect(r1.status).toBe(201)
    const { source } = await r1.json() as { source: { id: string } }
    expect(source.id).toBeTruthy()
    const r2 = await fetch(`${server.url}/skill-sources/${source.id}/skills`)
    const { skills } = await r2.json() as { skills: Array<{ name: string; inLib: boolean }> }
    expect(skills.map((s) => s.name).sort()).toEqual(['docx', 'pdf'])
    expect(skills.every((s) => s.inLib === false)).toBe(true)
  })
  it('POST /skill-library/toggle inLib:true → GET /skill-library 含该技能（带 desc）', async () => {
    const { srcFolder } = await start()
    const { source } = await (await addFolder(srcFolder)).json() as { source: { id: string } }
    const rt = await fetch(`${server.url}/skill-library/toggle`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sourceId: source.id, relPath: 'pdf/', inLib: true }) })
    expect(rt.status).toBe(200)
    const r3 = await fetch(`${server.url}/skill-library`)
    const { skills } = await r3.json() as { skills: Array<{ name: string; effectiveName: string; desc: string }> }
    expect(skills.map((s) => s.name)).toContain('pdf')
    expect(skills.find((s) => s.name === 'pdf')!.desc).toBe('PDF 工具')
  })
  it('GET /skill-sources/:id/skills 源不存在 → 404', async () => {
    await start()
    const r = await fetch(`${server.url}/skill-sources/nope/skills`)
    expect(r.status).toBe(404)
  })
  it('PATCH /skill-sources/:id 源不存在 → 404', async () => {
    await start()
    const r = await fetch(`${server.url}/skill-sources/nope`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ updateMode: 'auto' }) })
    expect(r.status).toBe(404)
  })
  it('GET /skill-sources/:id/skill-md 返回 SKILL.md 原文；越界 → 404', async () => {
    const { srcFolder } = await start()
    const { source } = await (await addFolder(srcFolder)).json() as { source: { id: string } }
    const r = await fetch(`${server.url}/skill-sources/${source.id}/skill-md?relPath=${encodeURIComponent('pdf/')}`)
    expect(r.status).toBe(200)
    expect((await r.json() as { content: string }).content).toContain('name: pdf')
    const bad = await fetch(`${server.url}/skill-sources/${source.id}/skill-md?relPath=${encodeURIComponent('../../')}`)
    expect(bad.status).toBe(404)
  })
  it('源响应不回传 token（脱敏）', async () => {
    const { srcFolder } = await start()
    const { source } = await (await addFolder(srcFolder)).json() as { source: { id: string } }
    // PATCH 加私有 token；响应与后续 GET 都不应含该 token 值
    const rp = await fetch(`${server.url}/skill-sources/${source.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ private: true, token: 'secret-xyz' }) })
    const patched = await rp.json() as { source: { token?: string } }
    expect(patched.source.token).toBeUndefined()
    const rg = await fetch(`${server.url}/skill-sources`)
    const { sources } = await rg.json() as { sources: Array<{ token?: string }> }
    expect(sources.every((s) => s.token === undefined)).toBe(true)
  })
})
