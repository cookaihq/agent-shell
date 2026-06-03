import { describe, it, expect, afterEach } from 'vitest'
import net from 'node:net'
import fs from 'node:fs'
import path from 'node:path'
import { serveDaemonUrl, discoverDaemonUrl, ipcSocketPath, isNamedPipe, pushUrlToPeer } from '../index'

let closers: Array<() => Promise<void>> = []
afterEach(async () => { for (const c of closers) await c(); closers = [] })

describe('sidecar 服务发现', () => {
  it('发布的 URL 能被发现端读到（round-trip）', async () => {
    const ns = 'test-rt'
    const handle = await serveDaemonUrl('http://127.0.0.1:54321', ns)
    closers.push(handle.close)
    const url = await discoverDaemonUrl({ namespace: ns, timeoutMs: 2000 })
    expect(url).toBe('http://127.0.0.1:54321')
  })

  it('socket 路径按 namespace、不含端口', () => {
    const p = ipcSocketPath('abc')
    expect(p).toContain('abc')
    expect(p).toMatch(/daemon\.sock$/)
  })

  it('无人发布时发现端超时抛错', async () => {
    await expect(
      discoverDaemonUrl({ namespace: 'test-nobody', timeoutMs: 300, intervalMs: 50 }),
    ).rejects.toThrow(/超时|timeout/i)
  })

  it('存在陈旧 socket 文件时仍能发布并被发现', async () => {
    const ns = 'test-stale'
    const socketPath = ipcSocketPath(ns)
    fs.mkdirSync(path.dirname(socketPath), { recursive: true })
    fs.writeFileSync(socketPath, 'stale')   // 残留的非 socket 文件
    const h = await serveDaemonUrl('http://127.0.0.1:2', ns)
    closers.push(h.close)
    const url = await discoverDaemonUrl({ namespace: ns, timeoutMs: 2000 })
    expect(url).toBe('http://127.0.0.1:2')
  })

  it('对方接上但不回复时，发现端按时超时而非永久挂起', async () => {
    const ns = 'test-silent'
    const socketPath = ipcSocketPath(ns)
    fs.mkdirSync(path.dirname(socketPath), { recursive: true })
    try { fs.unlinkSync(socketPath) } catch {}
    const silent = net.createServer(() => { /* 接受但什么都不发 */ })
    await new Promise<void>((r) => silent.listen(socketPath, () => r()))
    closers.push(() => new Promise<void>((r) => silent.close(() => r())))
    const start = Date.now()
    await expect(
      discoverDaemonUrl({ namespace: ns, timeoutMs: 400, intervalMs: 50 }),
    ).rejects.toThrow(/超时|timeout/i)
    expect(Date.now() - start).toBeLessThan(2000)
  })

  it('pushUrlToPeer：socket 出错（EPIPE/对端先断）不外抛，不会崩 daemon', () => {
    // 直接在 socket 上触发 'error'：无修复（没挂 socket 级监听）时，未捕获事件会同步抛出。
    // 挂了 fail-soft 监听后，emit 被吞，不外抛 → daemon 存活。
    const sock = new net.Socket()
    pushUrlToPeer(sock, 'http://127.0.0.1:9')
    expect(() => sock.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }))).not.toThrow()
    sock.destroy()
  })

  it('win32 平台返回命名管道路径（spec §2.4：\\\\.\\pipe\\agent-shell-<ns>）', () => {
    expect(ipcSocketPath('abc', 'win32')).toBe('\\\\.\\pipe\\agent-shell-abc')
  })

  it('posix 平台仍返回 unix socket 文件路径', () => {
    const p = ipcSocketPath('abc', 'darwin')
    expect(p).toContain('abc')
    expect(p).toMatch(/daemon\.sock$/)
    expect(isNamedPipe(p)).toBe(false)
  })

  it('isNamedPipe 谓词：仅 \\\\.\\pipe\\ 前缀为真', () => {
    expect(isNamedPipe('\\\\.\\pipe\\agent-shell-x')).toBe(true)
    expect(isNamedPipe('/tmp/agent-shell/ipc/x/daemon.sock')).toBe(false)
  })
})
