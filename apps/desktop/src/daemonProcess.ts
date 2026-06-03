import path from 'node:path'
import { spawn, type ChildProcess } from 'node:child_process'

// daemon 的 esbuild 自包含 bundle（build.mjs 产出到 desktop dist/daemon）。本文件被打进
// dist/main.cjs，故从 __dirname（=dist）看是 ./daemon/entry.bundle.mjs。统一布局（M8d）——
// dev 与打包后路径一致；bundle 里 external 的 better-sqlite3 沿 node_modules 上溯解析
// （dev: apps/desktop/node_modules；打包: Resources/app/node_modules）。
const DAEMON_ENTRY = path.resolve(__dirname, 'daemon/entry.bundle.mjs')

export interface DaemonHandle {
  stop: () => Promise<void>
  /** 同步强杀子进程，供主进程 exit/uncaughtException 兜底（这些回调里只能跑同步代码）。 */
  killSync: () => void
}

/**
 * 用 ELECTRON_RUN_AS_NODE 把 Electron 二进制当 Node 跑 daemon 的 esbuild bundle。webDir = renderer
 * 的 Vite 产物目录（同源 serve）。仅负责 spawn——**不在此阻塞等 sidecar 发现 URL**：URL 发现交给主
 * 进程的轮询（先上加载页、daemon 一就绪再切真页，且持续轮询以在 daemon 重启换端口时自愈，对齐 open-design）。
 */
export function startDaemonProcess(opts: { webDir: string; namespace?: string; authSecret?: string }): DaemonHandle {
  const namespace = opts.namespace ?? 'default'

  const child: ChildProcess = spawn(process.execPath, [DAEMON_ENTRY], {
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: '1',
      AGENT_SHELL_WEB_DIR: opts.webDir,
      AGENT_SHELL_NAMESPACE: namespace,
      ...(opts.authSecret ? { AGENT_SHELL_AUTH_SECRET: opts.authSecret } : {}),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  })

  let exited = false
  child.on('exit', () => { exited = true })

  return {
    stop: () =>
      new Promise<void>((resolve) => {
        if (exited || child.killed) return resolve()
        // 兜底：3s 未退则 SIGKILL（MVP §6 优雅关停降级）
        const timer = setTimeout(() => { if (!exited) child.kill('SIGKILL') }, 3000)
        child.once('exit', () => { clearTimeout(timer); resolve() })
        child.kill('SIGTERM')
      }),
    killSync: () => { if (!exited && !child.killed) child.kill('SIGKILL') },
  }
}
