import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'

/**
 * 自带版 claude 二进制解析（对齐 codex/resolveBin 的「自带版」机制）。
 *
 * claude 引擎的原生 CLI 随 `@anthropic-ai/claude-agent-sdk` 的平台子包打进包——SDK 执行时（不传
 * `pathToClaudeCodeExecutable`）跑的就是这个二进制。检测层据此显示版本，才能「显示=实际执行」，
 * 且不依赖本机另装 claude（修「执行模式页显示本机 PATH 版而非自带版」的不一致）。
 *
 * 解析链（镜像 codex resolveBin）：
 *   1. 以本模块为锚点 `require.resolve('@anthropic-ai/claude-agent-sdk')`（主入口；SDK 的 exports
 *      不暴露 ./package.json，故不能直接解析其 package.json，用主入口当锚点）；
 *   2. 平台原生包是 SDK 的 optionalDependency，须**从 SDK 锚点**解析
 *      `@anthropic-ai/claude-agent-sdk-<platform>-<arch>/package.json`；
 *   3. 子包目录下的 `claude`（win32 为 `claude.exe`）即原生二进制（子包 package.json `files:['claude',…]`）。
 *
 * linux 有 glibc / musl 两套子包（…-linux-x64 / …-linux-x64-musl），按 os/cpu/libc 只装匹配的一套——
 * 故按候选名逐个 resolve、「装了哪个用哪个」，无需自行探测 libc。
 *
 * dev 与 packaged 一视同仁：都走 createRequire 沿 node_modules 上溯（与 codex resolveBin 同机制）。
 * 无系统版兜底：解析失败直接抛——宁可明确报错/显示不可用，也不静默回落到版本可能不符的系统 claude
 * （执行侧本就用自带版、不回落系统，检测对齐之）。
 */

export interface ResolveClaudeDeps {
  platform: NodeJS.Platform
  arch: NodeJS.Architecture
  /** 从 anchor 解析模块（缺省 = createRequire(anchor).resolve）。anchor 是 file:// URL 或绝对路径。 */
  resolveFrom: (anchor: string, request: string) => string
  fileExists: (p: string) => boolean
}

function realDeps(): ResolveClaudeDeps {
  return {
    platform: process.platform,
    arch: process.arch,
    resolveFrom: (anchor, request) => createRequire(anchor).resolve(request),
    fileExists: (p) => { try { return fs.statSync(p).isFile() } catch { return false } },
  }
}

/** 当前 platform+arch 对应的平台子包候选名（linux 含 musl 变体；按顺序试，装了哪个用哪个）。 */
export function platformPackageCandidates(platform: NodeJS.Platform, arch: NodeJS.Architecture): string[] {
  const base = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`
  // linux 区分 glibc / musl：两套子包名仅后缀不同，按 os/cpu/libc 只装一套，逐个试即可命中已装的那套。
  return platform === 'linux' ? [base, `${base}-musl`] : [base]
}

/** 子包内原生二进制候选文件名（win32 优先 .exe，posix 裸名）。 */
function binCandidates(platform: NodeJS.Platform): string[] {
  return platform === 'win32' ? ['claude.exe', 'claude'] : ['claude']
}

/**
 * 解析自带版 claude 二进制绝对路径。
 * anchor(本模块) → require.resolve(@anthropic-ai/claude-agent-sdk 主入口) → 从 SDK 锚点解析平台子包
 * package.json → 子包目录下 claude。任一环失败抛清晰错误（无系统版兜底）。
 */
export function resolveClaudeBinary(deps: ResolveClaudeDeps = realDeps()): string {
  // ① 定位 @anthropic-ai/claude-agent-sdk 自身（用主入口当锚点；不同 anchor 都从本模块上溯 node_modules，dev/packaged 一致）。
  const selfAnchor = (import.meta as { url?: string }).url ?? path.join(process.cwd(), 'noop.js')
  let sdkMain: string
  try {
    sdkMain = deps.resolveFrom(selfAnchor, '@anthropic-ai/claude-agent-sdk')
  } catch {
    throw new Error('[claude] 未找到自带版 @anthropic-ai/claude-agent-sdk 依赖——请确认已随包安装（apps/desktop dependencies + electron-builder 纳入 node_modules）')
  }

  // ② 从 SDK 锚点解析平台原生子包（它是 SDK 的 optionalDependency，须从 SDK 自身锚点解析）。
  for (const pkg of platformPackageCandidates(deps.platform, deps.arch)) {
    let platPkgJson: string
    try {
      platPkgJson = deps.resolveFrom(sdkMain, `${pkg}/package.json`)
    } catch {
      continue // 该候选未安装（如 linux 另一种 libc）→ 试下一个
    }
    // ③ 子包目录下的 claude 二进制。
    const platDir = path.dirname(platPkgJson)
    for (const binName of binCandidates(deps.platform)) {
      const bin = path.join(platDir, binName)
      if (deps.fileExists(bin)) return bin
    }
  }

  throw new Error(`[claude] 未找到自带版 claude 二进制（${deps.platform}/${deps.arch}）——平台原生包可能未随包安装`)
}
