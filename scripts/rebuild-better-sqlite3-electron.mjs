// 把原生模块 better-sqlite3 的 .node 二进制取/编为 Electron 的 ABI。
//
// 背景：better-sqlite3 是 NAN 类原生模块，.node 绑定特定 NODE_MODULE_VERSION（ABI）。系统 node 与
// Electron 的 ABI 不同。本项目统一以 **Electron ABI** 为唯一 ABI——daemon 在 prod 跑于 Electron-as-node，
// 测试也经 scripts/vitest-electron.mjs 在 Electron-as-node 下跑。于是 install/test/pack/运行 全链路只有
// 一个 ABI，原生模块永不需要来回 rebuild（根除"双 ABI 循环"）。
//
// 本脚本由根 postinstall 调用：pnpm 装完依赖（better-sqlite3 默认取 node ABI 预编译）后，这里覆盖为
// Electron ABI。优先用 prebuild-install 拉 better-sqlite3 官方发布的 Electron 预编译包——**无需本地
// 编译、无需 C++ 工具链**；只有该平台/arch 没有预编译时才回退到 node-gyp 本地编译。
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)))

// Electron 版本取自 apps/desktop 的 devDependencies，避免与打包配置漂移。
function electronTarget() {
  const pkg = JSON.parse(readFileSync(`${repoRoot}/apps/desktop/package.json`, 'utf8'))
  const v = pkg.devDependencies?.electron ?? pkg.dependencies?.electron
  if (!v) throw new Error('apps/desktop/package.json 未找到 electron 版本')
  return v.replace(/^[^\d]*/, '') // 去掉 ^ ~ 等前缀
}

// 从 daemon 包的视角解析 better-sqlite3 的真实目录（pnpm 下为 .pnpm store 内实体）。
function betterSqlite3Dir() {
  const daemonRequire = createRequire(`${repoRoot}/apps/daemon/package.json`)
  return dirname(daemonRequire.resolve('better-sqlite3/package.json'))
}

const target = electronTarget()
const moduleDir = betterSqlite3Dir()
const arch = process.arch

console.log(`[rebuild-sqlite] better-sqlite3 → Electron ${target} (${process.platform}-${arch}) @ ${moduleDir}`)

try {
  // 首选：拉官方 Electron 预编译（快、无需编译器）。
  // shell:true：Windows 上 npx 实为 npx.cmd，execFileSync 不经 shell 无法 spawn 裸 'npx'（会 ENOENT）；
  // target/arch 来自 package.json electron 版本与 process.arch，无 shell 元字符，拼接安全。
  execFileSync('npx', ['prebuild-install', '--runtime', 'electron', '--target', target, '--arch', arch], {
    cwd: moduleDir, stdio: 'inherit', shell: true,
  })
  console.log('[rebuild-sqlite] 用 Electron 预编译包完成 ✓')
} catch {
  // 回退：本地对 Electron 头文件编译（需 C++ 工具链）。
  console.log('[rebuild-sqlite] 无预编译包，回退 node-gyp 本地编译…')
  execFileSync('npx', ['node-gyp', 'rebuild', `--target=${target}`, `--arch=${arch}`, '--dist-url=https://electronjs.org/headers'], {
    cwd: moduleDir, stdio: 'inherit', shell: true,
  })
  console.log('[rebuild-sqlite] node-gyp 本地编译完成 ✓')
}
