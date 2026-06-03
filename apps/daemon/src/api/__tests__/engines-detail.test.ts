import { describe, it, expect, afterEach } from 'vitest'
import { startDaemon, type DaemonServer } from '../../server'

let server: DaemonServer
afterEach(async () => { await server?.close() })

describe('/engines/detail', () => {
  it('返回 claude/codex 的 name/label/bin（version 因 mock bin 调不出为 null）', async () => {
    server = await startDaemon({ detect: () => ({ claude: '/x/claude', codex: null }) })
    const res = await fetch(`${server.url}/engines/detail`)
    const { engines } = await res.json() as { engines: Array<{ name: string; label: string; bin: string | null; version: string | null }> }
    expect(engines).toHaveLength(2)
    expect(engines[0]).toMatchObject({ name: 'claude', label: 'Claude Code', bin: '/x/claude' })
    expect(engines[1]).toMatchObject({ name: 'codex', label: 'Codex CLI', bin: null, version: null })
  })
})
