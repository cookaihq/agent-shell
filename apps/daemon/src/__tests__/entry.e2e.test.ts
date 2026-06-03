import { describe, it, expect, afterEach } from 'vitest'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { discoverDaemonUrl } from '@agent-shell/sidecar'

const here = path.dirname(fileURLToPath(import.meta.url))
const entryTs = path.resolve(here, '../entry.ts')
let child: ChildProcess | null = null

afterEach(async () => {
  if (child && !child.killed) {
    child.kill('SIGTERM')
    await new Promise((r) => setTimeout(r, 300))
  }
  child = null
})

describe('daemon entry 进程', () => {
  it('起进程→sidecar 发现 URL→/health 与 / 可达→SIGTERM 退出', async () => {
    const ns = 'm8a-test-' + process.pid
    const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'm8a-entry-'))
    fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><div id=root>ENTRY</div>')

    // 用与测试自身相同的运行时起 daemon：pnpm test 经 scripts/vitest-electron.mjs 在 Electron-as-node
    // 下跑（process.execPath=Electron + 继承的 ELECTRON_RUN_AS_NODE），正是 prod 起 daemon 的方式。这样
    // 子进程加载的 better-sqlite3 .node 的 ABI 与测试运行时一致，避免 NODE_MODULE_VERSION 不匹配。
    // tsx 作为 ESM loader 处理 entry.ts 的 TS/无扩展名 import。
    child = spawn(process.execPath, ['--import', 'tsx', entryTs], {
      env: { ...process.env, AGENT_SHELL_NAMESPACE: ns, AGENT_SHELL_WEB_DIR: webDir },
      stdio: ['ignore', 'inherit', 'inherit'],
    })

    // 超时给足余量：单跑约 2s，但全量并发时 electron 再 spawn electron-as-node + tsx 现编整个
    // daemon，在 CPU 抢占下启动可达数十秒。给 45s 避免满载 flaky（不是 daemon 真慢，是编译/调度抢占）。
    const url = await discoverDaemonUrl({ namespace: ns, timeoutMs: 45000 })
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)

    const health = await fetch(url + '/health')
    expect((await health.json())).toEqual({ status: 'ok' })

    const root = await fetch(url + '/')
    expect(await root.text()).toContain('ENTRY')

    const exited = new Promise<number | null>((resolve) => child!.on('exit', (code) => resolve(code)))
    child.kill('SIGTERM')
    expect(await exited).not.toBeNull()
  }, 60000)
})
