import { describe, it, expect, afterEach } from 'vitest'
import { startDaemon, type DaemonServer } from '../server'
import { openDatabase } from '../db/database'

let server: DaemonServer | null = null
afterEach(async () => { if (server) await server.close(); server = null })

describe('daemon HTTP', () => {
  it('GET /health 返回 200 与 status ok', async () => {
    server = await startDaemon({ detect: () => ({ claude: '/x/claude', codex: '/x/codex' }), db: openDatabase(':memory:') })
    const res = await fetch(server.url + '/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('监听随机端口（非固定）', async () => {
    server = await startDaemon({ detect: () => ({ claude: '/x/claude', codex: null }), db: openDatabase(':memory:') })
    expect(server.port).toBeGreaterThan(0)
    expect(server.url).toBe(`http://127.0.0.1:${server.port}`)
  })

  it('GET /engines 返回检测到的引擎', async () => {
    server = await startDaemon({ detect: () => ({ claude: '/x/claude', codex: null }), db: openDatabase(':memory:') })
    const res = await fetch(server.url + '/engines')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ engines: { claude: '/x/claude', codex: null } })
  })

  it('两个引擎都缺时 /engines 返回 503 + cli_not_found', async () => {
    server = await startDaemon({ detect: () => ({ claude: null, codex: null }), db: openDatabase(':memory:') })
    const res = await fetch(server.url + '/engines')
    expect(res.status).toBe(503)
    const body = await res.json() as { error: { code: string } }
    expect(body.error.code).toBe('cli_not_found')
  })

  it('端口被占用时 startDaemon 拒绝而非崩溃', async () => {
    const a = await startDaemon({ detect: () => ({ claude: '/x/claude', codex: null }), db: openDatabase(':memory:') })
    try {
      await expect(
        startDaemon({ port: a.port, detect: () => ({ claude: '/x/claude', codex: null }), db: openDatabase(':memory:') }),
      ).rejects.toThrow(/占用|EADDRINUSE/i)
    } finally {
      await a.close()
    }
  })

  it('detect 抛错时 /engines 走错误中间件返回 500 + ApiError 形状', async () => {
    server = await startDaemon({ detect: () => { throw new Error('boom') }, db: openDatabase(':memory:') })
    const res = await fetch(server.url + '/engines')
    expect(res.status).toBe(500)
    const body = (await res.json()) as { error: { code: string } }
    expect(body.error.code).toBe('internal')
  })
})
