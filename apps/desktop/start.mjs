// 启动已构建的 desktop app（dist/main.cjs），让 electron 起 GUI。
//
// 为何用 node 启动器而非 `cross-env ELECTRON_RUN_AS_NODE= electron …`：
// start 的目的是「清掉 ELECTRON_RUN_AS_NODE」让 electron 走 GUI 主进程。但 cross-env 只能把变量
// **置成空串、删不掉**，而 Electron 判定是「**存在即生效**」（空串也算 run-as-node）。于是在继承了
// ELECTRON_RUN_AS_NODE=1 的终端里（VSCode 集成终端 / 任何嵌套 Electron 的 shell），electron 会被当
// 纯 node 跑 → `require('electron').app` 为 undefined → 崩在 `app.whenReady`。
// 这里用 node 真正 `delete` 掉该变量再 spawn electron，任何终端、任何平台都能起 GUI。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

delete process.env.ELECTRON_RUN_AS_NODE

const here = path.dirname(fileURLToPath(import.meta.url))
const electron = createRequire(import.meta.url)('electron') // electron 包默认导出其二进制的绝对路径
const main = path.join(here, 'dist', 'main.cjs')            // 绝对路径：不依赖 cwd
const child = spawn(electron, [main], { stdio: 'inherit' })
child.on('exit', (code) => process.exit(code ?? 0))
