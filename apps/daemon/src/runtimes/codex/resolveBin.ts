import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 自带版 codex 二进制解析（Part A · Phase 6）。
 *
 * D3「自带版」：codex 二进制随 `@openai/codex` 依赖打进包，不再依赖系统装的 codex。
 * 本模块逐字节镜像官方 shim（`@openai/codex/bin/codex.js`）的解析逻辑：
 *   1. 以 `@openai/codex` 的 bin/codex.js 为锚点 createRequire；
 *   2. `require.resolve('@openai/codex-<platform>/package.json')` 定位平台子包（196MB 原生二进制所在的 optionalDependency）；
 *   3. 平台包目录下 `vendor/<targetTriple>/bin/codex`（可执行）+ `vendor/<targetTriple>/codex-path`（含 ripgrep `rg`，codex 文件搜索必需 → 须 prepend 进 PATH）。
 *
 * dev 与 packaged 一视同仁：都走 `createRequire` 沿 node_modules 上溯解析（与 sessionRuntime SDK_VERSION 同机制）。
 * dev = worktree node_modules；packaged = Resources/app/node_modules（asar:false，electron-builder 随生产依赖纳入）。
 *
 * 无系统版兜底（D3）：解析失败直接抛——宁可明确报错，不静默回落到一个可能版本不符的系统 codex。
 */

const PLATFORM_PACKAGE_BY_TARGET: Record<string, string> = {
  'x86_64-unknown-linux-musl': '@openai/codex-linux-x64',
  'aarch64-unknown-linux-musl': '@openai/codex-linux-arm64',
  'x86_64-apple-darwin': '@openai/codex-darwin-x64',
  'aarch64-apple-darwin': '@openai/codex-darwin-arm64',
  'x86_64-pc-windows-msvc': '@openai/codex-win32-x64',
  'aarch64-pc-windows-msvc': '@openai/codex-win32-arm64',
}

/** platform+arch → codex targetTriple（与 shim 的 switch 等价）；不支持的组合返回 null。 */
export function targetTripleFor(platform: NodeJS.Platform, arch: string): string | null {
  switch (platform) {
    case 'linux':
    case 'android':
      if (arch === 'x64') return 'x86_64-unknown-linux-musl'
      if (arch === 'arm64') return 'aarch64-unknown-linux-musl'
      return null
    case 'darwin':
      if (arch === 'x64') return 'x86_64-apple-darwin'
      if (arch === 'arm64') return 'aarch64-apple-darwin'
      return null
    case 'win32':
      if (arch === 'x64') return 'x86_64-pc-windows-msvc'
      if (arch === 'arm64') return 'aarch64-pc-windows-msvc'
      return null
    default:
      return null
  }
}

/** targetTriple → 平台子包名（@openai/codex-darwin-arm64 等）。 */
export function platformPackageFor(triple: string): string | undefined {
  return PLATFORM_PACKAGE_BY_TARGET[triple]
}

export interface ResolveCodexBinary {
  /** codex 原生可执行文件绝对路径（spawn app-server 用）。 */
  binPath: string
  /** vendor/<triple>/codex-path 目录：含 ripgrep `rg`，须 prepend 到 spawn 的 PATH（codex 文件搜索依赖）。 */
  pathDir: string
}

/** 可注入依赖（测试用：覆盖 packaged 分支语义而不真造文件）。 */
export interface ResolveCodexDeps {
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
  /** 从 anchor 解析模块（缺省 = createRequire(anchorUrl).resolve）。anchor 是 file:// URL 或绝对路径。 */
  resolveFrom: (anchor: string, request: string) => string
  fileExists: (p: string) => boolean
}

function realDeps(): ResolveCodexDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    resolveFrom: (anchor, request) => createRequire(anchor).resolve(request),
    fileExists: (p) => { try { return fs.statSync(p).isFile() || fs.statSync(p).isDirectory() } catch { return false } },
  }
}

/**
 * 解析自带版 codex。镜像官方 shim：
 *   anchor(@openai/codex 自身) → require.resolve(platformPkg/package.json) → vendor/<triple>/bin/codex + codex-path。
 * 任一环失败抛清晰错误（无系统版兜底）。
 */
export function resolveCodexBinary(deps: ResolveCodexDeps = realDeps()): ResolveCodexBinary {
  const triple = targetTripleFor(deps.platform, deps.arch)
  if (!triple) throw new Error(`[codex] 不支持的平台：${deps.platform} (${deps.arch})`)
  const platformPackage = platformPackageFor(triple)
  if (!platformPackage) throw new Error(`[codex] 不支持的 targetTriple：${triple}`)

  // ① 定位 @openai/codex 自身（不同 anchor 都从本模块出发上溯 node_modules，dev/packaged 一致）。
  const selfAnchor = (import.meta as { url?: string }).url ?? path.join(process.cwd(), 'noop.js')
  let codexPkgJson: string
  try {
    codexPkgJson = deps.resolveFrom(selfAnchor, '@openai/codex/package.json')
  } catch {
    throw new Error('[codex] 未找到自带版 @openai/codex 依赖——请确认已随包安装（apps/desktop dependencies + electron-builder 纳入 node_modules）')
  }

  // ② 以 @openai/codex 的 bin/codex.js 为锚点解析平台子包（与 shim 的 createRequire(codex.js) 等价：
  //    平台包是 @openai/codex 的 optionalDependency，须从 codex 自身锚点解析，不能从本模块解析）。
  const codexShim = path.join(path.dirname(codexPkgJson), 'bin', 'codex.js')
  let platformPkgJson: string
  try {
    platformPkgJson = deps.resolveFrom(codexShim, `${platformPackage}/package.json`)
  } catch {
    throw new Error(`[codex] 缺少平台原生包 ${platformPackage}（当前 ${deps.platform}/${deps.arch}）——可能未安装对应平台的 optionalDependency`)
  }

  // ③ vendor 布局：新版 vendor/<triple>/bin/codex + codex-path；旧版 vendor/<triple>/codex/codex + path（兜底）。
  const binName = deps.platform === 'win32' ? 'codex.exe' : 'codex'
  const vendorRoot = path.join(path.dirname(platformPkgJson), 'vendor')
  const triplDir = path.join(vendorRoot, triple)

  const newBin = path.join(triplDir, 'bin', binName)
  if (deps.fileExists(newBin)) {
    return { binPath: newBin, pathDir: path.join(triplDir, 'codex-path') }
  }
  const legacyBin = path.join(triplDir, 'codex', binName)
  if (deps.fileExists(legacyBin)) {
    return { binPath: legacyBin, pathDir: path.join(triplDir, 'path') }
  }

  throw new Error(`[codex] 平台包 ${platformPackage} 内未找到 codex 可执行文件（${newBin}）——安装可能不完整`)
}
