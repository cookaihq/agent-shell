import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'

let server: DaemonServer, tmp: string
afterEach(async () => { await server?.close(); if (tmp) fs.rmSync(tmp, { recursive: true, force: true }) })

describe('/config', () => {
  it('GET 返回当前 config（projectsDir/skillsDir）', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-cfg-'))
    server = await startDaemon({ detect: () => ({ claude: '/x', codex: '/x' }), projectsDir: tmp, skillsDir: tmp })
    const res = await fetch(`${server.url}/config`)
    const body = await res.json() as { projectsDir: string; skillsDir: string }
    expect(body.projectsDir).toBe(tmp)
    expect(body.skillsDir).toBe(tmp)
  })
})
