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

