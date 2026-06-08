import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'

let server: DaemonServer, tmp: string
afterEach(async () => { await server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })

async function boot(reqs: Record<string, unknown>, secrets: { secrets: unknown[] }) {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cfgchk-'))
  const reqFile = path.join(tmp, 'entity-requirements.json')
  const secFile = path.join(tmp, 'secrets.json')
  fs.writeFileSync(reqFile, JSON.stringify({ version: 1, requirements: reqs }))
  fs.writeFileSync(secFile, JSON.stringify({ version: 1, ...secrets }))
  server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), skillsDir: tmp, entityRequirementsPath: reqFile, secretsPath: secFile })
}
const post = (url: string, body: unknown) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })

describe('POST /skill-config-check', () => {
  it('必填未绑 → missing', async () => {
    await boot({ 'skill:gaode': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'GAODE_API_KEY', bind: null, optional: false }] } }, { secrets: [] })
    const res = await post(`${server.url}/skill-config-check`, { skills: ['gaode'] })
    const body = await res.json() as { conflicts: unknown[]; missing: Array<{ entityRef: string; slot: string }> }
    expect(body.missing).toEqual([{ entityRef: 'skill:gaode', slot: 'GAODE_API_KEY' }])
    expect(body.conflicts).toEqual([])
  })
  it('已绑 → 无 missing', async () => {
    await boot({ 'skill:gaode': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'GAODE_API_KEY', bind: 'k_1', optional: false }] } }, { secrets: [{ id: 'k_1', name: 'g', value: 'v', note: '', createdAt: 1 }] })
    const res = await post(`${server.url}/skill-config-check`, { skills: ['gaode'] })
    const body = await res.json() as { missing: unknown[] }
    expect(body.missing).toEqual([])
  })
  it('同名 env 绑不同 secret + 同时选中 → conflict', async () => {
    await boot({
      'skill:a': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'K', bind: 'k_1', optional: false }] },
      'skill:b': { needsConfig: true, slotsSource: 'manual', slots: [{ kind: 'env', name: 'K', bind: 'k_2', optional: false }] },
    }, { secrets: [{ id: 'k_1', name: 'a', value: 'v1', note: '', createdAt: 1 }, { id: 'k_2', name: 'b', value: 'v2', note: '', createdAt: 2 }] })
    const res = await post(`${server.url}/skill-config-check`, { skills: ['a', 'b'] })
    const body = await res.json() as { conflicts: Array<{ env: string }> }
    expect(body.conflicts.map(c => c.env)).toEqual(['K'])
  })
})
