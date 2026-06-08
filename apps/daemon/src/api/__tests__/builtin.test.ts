import { describe, it, expect, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { startDaemon, type DaemonServer } from '../../server'

let server: DaemonServer, tmp: string

afterEach(async () => {
  await server?.close()
  if (tmp) fs.rmSync(tmp, { recursive: true, force: true })
})

describe('builtin source', () => {
  it('startDaemon({builtinSkillsDir}) → 源含 builtin + 内置 skill 入库 + 拒删 403', async () => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-bi-'))
    const builtinDir = path.join(tmp, 'builtin-skills')
    const sk = path.join(builtinDir, 'install-skill')
    fs.mkdirSync(sk, { recursive: true })
    fs.writeFileSync(path.join(sk, 'SKILL.md'), '---\nname: install-skill\nautoInject: true\n---\n说明')

    server = await startDaemon({
      detect: () => ({ claude: '/x', codex: '/x' }),
      skillsDir: path.join(tmp, 'skills'),
      builtinSkillsDir: builtinDir,
    })

    const { sources } = await (await fetch(`${server.url}/skill-sources`)).json() as { sources: Array<{ id: string; type: string }> }
    expect(sources.find((s) => s.type === 'builtin')?.id).toBe('builtin')

    const { skills } = await (await fetch(`${server.url}/skill-library`)).json() as { skills: Array<{ name: string; autoInject: boolean }> }
    expect(skills.find((s) => s.name === 'install-skill')?.autoInject).toBe(true)

    const del = await fetch(`${server.url}/skill-sources/builtin`, { method: 'DELETE' })
    expect(del.status).toBe(403)
  })
})
