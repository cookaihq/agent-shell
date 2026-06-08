import { build } from 'esbuild'
import { cpSync, rmSync } from 'node:fs'
import { execSync } from 'node:child_process'

// 把 daemon entry 与 desktop 主进程各打成自包含 bundle（贴 open-design 的 esbuild 做法）。
// 为何打包：仓库源码用「省略扩展名 + moduleResolution Bundler」，tsc 直接 emit 的 dist
// 在裸 Node ESM 下解析不了相对 import；bundle 把本地源码（含 workspace 包）全内联，从根消除该问题。
// external 取舍：原生模块 better-sqlite3 无法打包，留给运行时从 node_modules 解析（唯一外部依赖）。
// express 改为内联进 bundle（M8d）——使全包只剩 better-sqlite3 一个原生外部依赖，大幅简化打包。
const common = { bundle: true, format: 'esm', platform: 'node', target: 'node20', logLevel: 'info' }

// 构建渠道：pack:mac:dev / build:dev 会设 AGENT_SHELL_CHANNEL=dev；缺省 stable。
// 仅内联进 main（主进程据此派生 namespace/dataDir + 关 dev 更新器）。daemon 侧只认运行时 env，无需内联。
const CHANNEL = process.env.AGENT_SHELL_CHANNEL || 'stable'

await build({
  ...common,
  entryPoints: ['../daemon/src/entry.ts'],
  // 统一布局（M8d）：daemon bundle 出到 desktop 自己的 dist/daemon，与 main.cjs 同在 dist 下，
  // 打包后落 Resources/app/dist/daemon，沿 node_modules 上溯解析 better-sqlite3；dev/packaged 一致。
  outfile: 'dist/daemon/entry.bundle.mjs',
  // external：原生模块 better-sqlite3 无法打包；@anthropic-ai/claude-agent-sdk 自带 218MB 平台二进制
  // （sdk.mjs 用 createRequire 锚定自身定位），打包后由 electron-builder 随 node_modules 纳入、运行时上溯解析。
  // @openai/codex 同理（Part A P6 自带版）：196MB 平台原生二进制（optionalDependency），resolveBin.ts 用
  // createRequire 锚定 @openai/codex 自身→平台子包 vendor/<triple>/bin/codex；保持 external、运行时从 node_modules 解析。
  external: ['better-sqlite3', '@anthropic-ai/claude-agent-sdk', '@openai/codex'],
  // express 等 CJS 依赖被打进 ESM bundle 后，其内部 require 被 esbuild 改写成会抛错的
  // __require stub（"Dynamic require of X is not supported"）。注入真实 require：esbuild 的
  // __require 检测到 `typeof require !== "undefined"` 即委托给它，CJS 依赖的动态 require 恢复可用。
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
})

// §10 create_automation（codex 侧）：把独立 stdio MCP server 打成自包含 bundle，与 main.cjs 同级 dist/。
// codex app-server 经 -c mcp_servers.automation.args=["<abs>/automation-mcp.bundle.mjs"] spawn 它。
// @modelcontextprotocol/sdk 纯 JS 内联；better-sqlite3 原生外部，运行时上溯 node_modules 解析。
await build({
  ...common,
  entryPoints: ['../daemon/src/automation/mcp/automationMcpServer.ts'],
  outfile: 'dist/automation-mcp.bundle.mjs',
  external: ['better-sqlite3'],
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
})

// 主进程出 CJS：Electron 主进程对 CJS 的 require('electron') 注入内置模块是标准可靠路径，
// ESM 产物下该注入不可靠（具名导出探测失败 / default 非真模块）。main 无 top-level await，可 CJS。
await build({
  ...common,
  format: 'cjs',
  entryPoints: ['src/main.ts'],
  outfile: 'dist/main.cjs',
  external: ['electron'],
  define: { 'process.env.AGENT_SHELL_CHANNEL': JSON.stringify(CHANNEL) },
})

// preload 出 CJS：与主进程同理，require('electron') 在 CJS 下可靠；沙箱 preload 保持 dependency-free。
await build({
  ...common,
  format: 'cjs',
  entryPoints: ['src/preload.cts'],
  outfile: 'dist/preload.cjs',
  external: ['electron'],
})

// 先重建 renderer，再拷进 desktop dist/web。
// 为何在此自动跑：单跑 desktop build 若只拷旧 web-dist，会静默把过期前端打进包——给人「已重建」的
// 假象（正是右下角版本号要抓的「跑的是旧代码」问题）。自动重建从根上杜绝，让 `desktop build` 一条命令即最新。
console.log('[build] rebuilding renderer (vite build)…')
execSync('npm run build', { cwd: '../renderer', stdio: 'inherit' })

// 统一布局（M8d）：把 renderer 的 Vite 产物拷进 desktop dist/web。
// dev 与打包都从 main.cjs 同级 ./web serve renderer，无需 app.isPackaged 分支。
rmSync('dist/web', { recursive: true, force: true })
cpSync('../renderer/web-dist', 'dist/web', { recursive: true })

// §9 builtin 源：把 daemon 侧的内置技能目录拷进 desktop dist/builtin-skills，
// 与 dist/web 同级；main.cjs 在 dist/ 下，故 path.resolve(__dirname,'builtin-skills') 在
// dev（electron dist/main.cjs）与打包（Resources/app/dist/main.cjs）下路径一致。
rmSync('dist/builtin-skills', { recursive: true, force: true })
cpSync('../daemon/src/builtin-skills', 'dist/builtin-skills', { recursive: true })

// §16.3 builtin automation：把 daemon 侧的内置自动任务目录拷进 dist/builtin-automations，
// 与 dist/builtin-skills 同级；main.cjs 经 path.resolve(__dirname,'builtin-automations') 定位（dev/打包一致）。
rmSync('dist/builtin-automations', { recursive: true, force: true })
cpSync('../daemon/src/builtin-automations', 'dist/builtin-automations', { recursive: true })
