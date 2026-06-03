import { describe, it, expect, afterEach } from 'vitest'
import { boot, type BootHandle } from '../index'
import { startDaemon } from '../server'
import { openDatabase } from '../db/database'
import { discoverDaemonUrl } from '@agent-shell/sidecar'

let handle: BootHandle | null = null
afterEach(async () => { if (handle) await handle.stop(); handle = null })

describe('daemon boot 端到端', () => {
  it('起 HTTP 并经 sidecar socket 可发现，命中 /health', async () => {
    const ns = 'test-boot'
    handle = await boot({ namespace: ns, detect: () => ({ claude: '/x/claude', codex: null }), db: openDatabase(':memory:') })
    const url = await discoverDaemonUrl({ namespace: ns, timeoutMs: 2000 })
    expect(url).toBe(handle.daemon.url)
    const res = await fetch(url + '/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ status: 'ok' })
  })

  it('sidecar 发布失败时 boot 关闭已起的 daemon（端口被释放，证明不泄漏）', async () => {
    // 先拿一个已知可用端口（起一个随机端口 daemon 再关掉）
    const probe = await startDaemon({ detect: () => ({ claude: '/x/claude', codex: null }), db: openDatabase(':memory:') })
    const port = probe.port
    await probe.close()
    // 用该固定端口起 daemon；NUL namespace 让 serveDaemonUrl 同步抛 → boot 的 catch 应 await daemon.close()
    await expect(
      boot({ port, namespace: 'bad\0ns', detect: () => ({ claude: '/x/claude', codex: null }), db: openDatabase(':memory:') }),
    ).rejects.toThrow()
    // 若 daemon 真被关闭，端口已释放 → 能在同一端口重新绑定（这才证明没泄漏）
    const again = await startDaemon({ port, detect: () => ({ claude: '/x/claude', codex: null }), db: openDatabase(':memory:') })
    expect(again.port).toBe(port)
    await again.close()
  })

  it('stop 可重复调用（幂等）', async () => {
    const h = await boot({ namespace: 'test-boot-idem', detect: () => ({ claude: '/x/claude', codex: null }), db: openDatabase(':memory:') })
    await h.stop()
    await expect(h.stop()).resolves.toBeUndefined()
  })
})
