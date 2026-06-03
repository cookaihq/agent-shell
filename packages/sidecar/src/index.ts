import net from 'node:net'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

export interface SidecarHandle {
  socketPath: string
  close: () => Promise<void>
}

/** 判定路径是否为 win32 命名管道（`\\.\pipe\...`）——命名管道不是文件系统文件，须跳过 mkdir/unlink。 */
export function isNamedPipe(p: string): boolean {
  return p.startsWith('\\\\.\\pipe\\')
}

/** IPC 路径：按 namespace 隔离、不嵌端口（借鉴 open-design）。posix 用 unix socket 文件，win32 用命名管道。 */
export function ipcSocketPath(namespace = 'default', platform: NodeJS.Platform = process.platform): string {
  if (platform === 'win32') {
    return `\\\\.\\pipe\\agent-shell-${namespace}`
  }
  return path.join(os.tmpdir(), 'agent-shell', 'ipc', namespace, 'daemon.sock')
}

/**
 * 把 URL 写给一个连入的发现端并关闭该连接。
 * 关键：先挂 socket 级 'error' 再写——对端可能在我们写之前就断开（发现方探测后立即 close），
 * 此时 end() 的写入会抛 EPIPE/ECONNRESET；server 级 error 不接管单条连接的错误，
 * 若不在 socket 上挂 'error'，未捕获事件会崩掉整个 daemon。fail-soft：对端走了就算了。
 * 导出仅供单测验证「socket 出错不外抛」。
 */
export function pushUrlToPeer(sock: net.Socket, url: string): void {
  sock.on('error', () => { /* 对端已走，无所谓 */ })
  sock.end(JSON.stringify({ url }) + '\n')
}

/** daemon 侧：在 socket 上发布真实 URL。每个连接收到一行 `{"url":...}\n` 后即关闭。 */
export async function serveDaemonUrl(url: string, namespace = 'default'): Promise<SidecarHandle> {
  const socketPath = ipcSocketPath(namespace)
  if (!isNamedPipe(socketPath)) {
    fs.mkdirSync(path.dirname(socketPath), { recursive: true })
    try { fs.unlinkSync(socketPath) } catch { /* 无陈旧文件则忽略 */ }
  }
  const server = net.createServer((sock) => pushUrlToPeer(sock, url))
  await new Promise<void>((resolve, reject) => {
    const onListenError = (err: NodeJS.ErrnoException) => {
      reject(err.code === 'EADDRINUSE'
        ? new Error(`sidecar socket 已被占用（namespace=${namespace}）：${socketPath}`)
        : err)
    }
    server.once('error', onListenError)
    server.listen(socketPath, () => {
      server.off('error', onListenError)
      server.on('error', (err) => { console.error('[sidecar] socket 错误:', err) })
      resolve()
    })
  })
  return {
    socketPath,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => {
          if (!isNamedPipe(socketPath)) {
            try { fs.unlinkSync(socketPath) } catch { /* 已删则忽略 */ }
          }
          resolve()
        })
      }),
  }
}

/** 前端侧：轮询连接 socket，读取一行 JSON 拿 URL；超时抛错（MVP §6：轮询带超时，不无限转圈）。 */
export async function discoverDaemonUrl(
  opts: { namespace?: string; timeoutMs?: number; intervalMs?: number } = {},
): Promise<string> {
  const socketPath = ipcSocketPath(opts.namespace ?? 'default')
  const timeoutMs = opts.timeoutMs ?? 5000
  const intervalMs = opts.intervalMs ?? 100
  const deadline = Date.now() + timeoutMs

  const tryOnce = (budgetMs: number): Promise<string | null> =>
    new Promise((resolve) => {
      const sock = net.connect(socketPath)
      let buf = ''
      let done = false
      const finish = (v: string | null) => {
        if (done) return
        done = true
        sock.destroy()
        resolve(v)
      }
      sock.setEncoding('utf8')
      sock.setTimeout(Math.max(1, budgetMs), () => finish(null))  // 接上但不回复 → 到点放弃
      sock.on('data', (d) => { buf += d })
      sock.on('error', () => finish(null))
      sock.on('end', () => {
        const line = buf.split('\n')[0]
        if (!line) return finish(null)
        try { finish(JSON.parse(line).url ?? null) } catch { finish(null) }
      })
    })

  while (Date.now() < deadline) {
    const url = await tryOnce(deadline - Date.now())
    if (url) return url
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  throw new Error(`发现 daemon 超时（${timeoutMs}ms）：${socketPath}`)
}
