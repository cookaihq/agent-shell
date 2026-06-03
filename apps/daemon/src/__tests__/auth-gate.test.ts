import { describe, it, expect, afterEach } from 'vitest'
import { startDaemon, type DaemonServer } from '../server'
import { openDatabase } from '../db/database'
import { AUTH_HEADER, AUTH_PENDING_CODE } from '@agent-shell/contracts'

const detect = () => ({ claude: '/x/claude', codex: null })
const SECRET = 'test-secret-abc'
let server: DaemonServer | null = null
afterEach(async () => { if (server) await server.close(); server = null })

describe('daemon token gate（条件启用）', () => {
  it('未配 authSecret 时不 gate：/api/health 无 token 也 200（dev/测试向后兼容）', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:') })
    const res = await fetch(server.url + '/api/health')
    expect(res.status).toBe(200)
  })

  it('配了 authSecret：/api/* 缺 token → 503 DESKTOP_AUTH_PENDING', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:'), authSecret: SECRET })
    const res = await fetch(server.url + '/api/health')
    expect(res.status).toBe(503)
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(AUTH_PENDING_CODE)
  })

  it('配了 authSecret：带正确 token → 放行', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:'), authSecret: SECRET })
    const res = await fetch(server.url + '/api/health', { headers: { [AUTH_HEADER]: SECRET } })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('配了 authSecret：带错误 token → 503', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:'), authSecret: SECRET })
    const res = await fetch(server.url + '/api/health', { headers: { [AUTH_HEADER]: 'wrong' } })
    expect(res.status).toBe(503)
  })

  it('配了 authSecret：静态资源/SPA 非 /api 无 token 也放行（否则页面加载不出）', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path')
    const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm8b-web-'))
    fs.writeFileSync(path.join(webDir, 'index.html'), '<div id=root>OK</div>')
    server = await startDaemon({ detect, db: openDatabase(':memory:'), authSecret: SECRET, webDir })
    const res = await fetch(server.url + '/')
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('id=root')
    const spa = await fetch(server.url + '/some/client/route')
    expect(spa.status).toBe(200)
  })

  it('【回归】配了 authSecret：裸路径 /projects（无 /api 前缀、无 token）不得返回数据', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:'), authSecret: SECRET })
    const res = await fetch(server.url + '/projects')
    expect(res.status).toBe(503)  // 无 webDir：裸路径非 GET-web-shell → 503，绝不命中 router
  })

  it('【回归】配了 authSecret：裸 /engines（无 token）不得泄露引擎信息', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:'), authSecret: SECRET })
    const res = await fetch(server.url + '/engines')
    expect(res.status).toBe(503)
  })

  it('【回归】配了 authSecret + webDir：裸 /projects（无 token）回 index.html 而非项目数据', async () => {
    const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path')
    const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm8b-bypass-'))
    fs.writeFileSync(path.join(webDir, 'index.html'), '<div id=root>SHELL</div>')
    server = await startDaemon({ detect, db: openDatabase(':memory:'), authSecret: SECRET, webDir })
    const res = await fetch(server.url + '/projects')
    expect(res.status).toBe(200)
    const body = await res.text()
    expect(body).toContain('id=root')          // 是 web-shell
    expect(body).not.toContain('"projects"')   // 不是 API 数据
  })

  it('【回归】配了 authSecret：带正确 token 的裸路径仍不放行（凭证只对 /api 有效）', async () => {
    server = await startDaemon({ detect, db: openDatabase(':memory:'), authSecret: SECRET })
    const res = await fetch(server.url + '/projects', { headers: { [AUTH_HEADER]: SECRET } })
    expect(res.status).toBe(503)  // 裸路径即便带 token 也不进 API（唯一入口是 /api）
  })
})
