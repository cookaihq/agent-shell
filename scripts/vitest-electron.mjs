// 在 Electron 的 node 运行时（ELECTRON_RUN_AS_NODE）下跑 vitest。
//
// 为何需要：daemon 用原生模块 better-sqlite3，其 .node 二进制绑定特定 ABI。打包后 app 的 daemon
// 跑在 Electron 的 node 上（ABI 145），而系统 node 是另一个 ABI（如 137）。为让"测试 ABI = 生产
// ABI"，better-sqlite3 统一编/取为 Electron ABI（见 scripts/rebuild-better-sqlite3-electron.mjs +
// 根 postinstall），测试也必须在 Electron-as-node 下跑——否则加载 .node 会 NODE_MODULE_VERSION 报错。
//
// 这样全链路（install → test → pack → 运行）只有一个 ABI，原生模块永不需要来回 rebuild。
import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'

const rootRequire = createRequire(import.meta.url)
// electron 是 apps/desktop 的 devDep，需从该包的 node_modules 解析（根 node_modules 没有它）。
const desktopRequire = createRequire(fileURLToPath(new URL('../apps/desktop/package.json', import.meta.url)))
const electronBin = desktopRequire('electron') // electron 包默认导出其二进制的绝对路径
const vitestCli = rootRequire.resolve('vitest/vitest.mjs')

const child = spawn(electronBin, [vitestCli, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
})
child.on('exit', (code) => process.exit(code ?? 1))
