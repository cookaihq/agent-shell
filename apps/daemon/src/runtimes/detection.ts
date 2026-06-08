import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectEngineVersion } from './engineInfo'
import { resolveCodexBinary } from './codex/resolveBin'
import { resolveClaudeBinary } from './claude/resolveBin'

export interface DetectionDeps {
  env: NodeJS.ProcessEnv
  home: string
  /** 运行平台。win32 时按 PATHEXT 给候选名补可执行扩展名（fs.stat 不像执行层那样自动补 .exe/.cmd）。 */
  platform: NodeJS.Platform
  fileExists: (p: string) => boolean
  listDir: (p: string) => string[]
  /** 跑 `<bin> --version`，成功返回版本号、失败返回 null。用于在多个安装间挑「真能跑起来」的那个。 */
  probeVersion: (binPath: string) => string | null
  /** 自带版 codex 解析（Part A P6）：codex 不再扫系统 PATH/NVM，detection 仅显示/诊断随包二进制。
   *  返回其 binPath（喂给 --version 显示 0.137.x），解析不到返回 null。测试可注入。 */
  resolveBundledCodex: () => string | null
  /** 自带版 claude 解析：claude 同样随 @anthropic-ai/claude-agent-sdk 平台子包打包，detection 报随包
   *  二进制路径（喂给 --version 显示 2.1.x），与 SDK 实际执行用的二进制一致、不依赖本机另装。
   *  解析不到返回 null。测试可注入。 */
  resolveBundledClaude: () => string | null
}

function realDeps(): DetectionDeps {
  return {
    env: process.env,
    home: os.homedir(),
    platform: process.platform,
    fileExists: (p) => {
      try {
        if (!fs.statSync(p).isFile()) return false
        fs.accessSync(p, fs.constants.X_OK)
        return true
      } catch { return false }
    },
    listDir: (p) => {
      try { return fs.readdirSync(p) } catch { return [] }
    },
    probeVersion: (p) => detectEngineVersion(p),
    resolveBundledCodex: () => { try { return resolveCodexBinary().binPath } catch { return null } },
    resolveBundledClaude: () => { try { return resolveClaudeBinary() } catch { return null } },
  }
}

/** 候选目录，按优先级：PATH → NVM 版本化 bin → Homebrew → 标准路径。 */
function candidateDirs(deps: DetectionDeps): string[] {
  // 按注入的 platform 取 path 语义（分隔符/拼接）——真机上 deps.platform=宿主，P 恒等于宿主 path（零行为变化）；
  // 仅当测试注入异平台时生效，使 win32 路径逻辑可在任意 host（mac/CI）被测。
  const P = deps.platform === 'win32' ? path.win32 : path.posix
  const dirs: string[] = []
  // 1. PATH（GUI 进程常不继承 shell PATH，所以后面还有兜底）
  for (const d of (deps.env.PATH ?? '').split(P.delimiter)) if (d) dirs.push(d)
  // 2. NVM：~/.nvm/versions/node/<ver>/bin —— 不同 node 版本下可能装着【不同版本号】的同名 CLI，
  //    且 readdirSync 默认是旧版在前。按 node 版本号【降序】排，让最新版目录最先被检索（借鉴 open-design
  //    sortVersionedDirEntries），配合下面「第一个能跑的就用」即天然命中最新安装、且不必探测旧/坏的版本。
  const nvmRoot = P.join(deps.home, '.nvm', 'versions', 'node')
  for (const ver of sortNodeVersionDirsDesc(deps.listDir(nvmRoot))) dirs.push(P.join(nvmRoot, ver, 'bin'))
  // 3. Homebrew（Apple Silicon + Intel）
  dirs.push('/opt/homebrew/bin', '/usr/local/bin')
  // 4. 标准路径 + npm 全局
  dirs.push(P.join(deps.home, '.local', 'bin'), '/usr/bin', '/bin')
  return dirs
}

/** 解析形如 `v24.13.0` / `24.13.0` 的版本目录名为数值三元组；非此形状返回 null。 */
function parseNodeVersionDir(name: string): [number, number, number] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(name)
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null
}

/** 把 node 版本目录名按 semver 降序（新版在前）；非版本名排到最后、用字典序兜底。借鉴 open-design。 */
export function sortNodeVersionDirsDesc(names: string[]): string[] {
  return [...names].sort((a, b) => {
    const pa = parseNodeVersionDir(a)
    const pb = parseNodeVersionDir(b)
    if (pa && pb) {
      for (let i = 0; i < 3; i++) { const d = pb[i] - pa[i]; if (d !== 0) return d }
      return 0
    }
    if (pa) return -1
    if (pb) return 1
    return a.localeCompare(b)
  })
}

/** 一个目录下某 CLI 的候选文件名。
 *  win32：npm/winget 装的是 `claude.exe` / `claude.cmd`，而 `fs.stat('…\\claude')` 不会像执行层那样
 *  按 PATHEXT 自动补扩展名 → 裸名永远 stat 不到，必须显式拿「裸名 + 各扩展名」逐个探测。
 *  posix：可执行文件无扩展名约定，只用裸名。导出供测试。 */
export function executableCandidates(name: string, platform: NodeJS.Platform, pathext: string | undefined): string[] {
  if (platform !== 'win32') return [name]
  const exts = (pathext ?? '.COM;.EXE;.BAT;.CMD')
    .split(';')
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean)
  return [name, ...exts.map((e) => name + e)]
}

export function detectBinary(name: string, deps: DetectionDeps = realDeps()): string | null {
  // 同名 CLI 在不同 node 版本里可能是不同安装形态：①老 npm JS 脚本（shebang env node，须 PATH 有 node）
  // ②新原生自包含二进制 ③坏的悬空软链。所以不能「找到第一个文件就用」——要挑第一个真能跑出版本的。
  // 候选目录已把 nvm 各版本按版本号降序排（见 candidateDirs），故「第一个能跑的」天然是最新可用安装，
  // 既选对又快（命中即停，不必探测旧/坏版本）。同一路径只探测一次（PATH 与 nvm/兜底目录常重叠）。
  // 都跑不出版本时退回第一个存在的文件，让上层显示「找到但调用失败」而非误报「未检测到 CLI」。
  // win32：每个目录内还要按 PATHEXT 试 name / name.exe / name.cmd …（见 executableCandidates），否则 winget/npm 装的 claude.exe 永远找不到。
  const P = deps.platform === 'win32' ? path.win32 : path.posix
  const fnames = executableCandidates(name, deps.platform, deps.env.PATHEXT)
  let firstExisting: string | null = null
  const seen = new Set<string>()
  for (const dir of candidateDirs(deps)) {
    for (const fname of fnames) {
      const p = P.join(dir, fname)
      if (seen.has(p)) continue
      seen.add(p)
      if (!deps.fileExists(p)) continue
      if (firstExisting === null) firstExisting = p
      if (deps.probeVersion(p) !== null) return p
    }
  }
  return firstExisting
}

export type EngineName = 'claude' | 'codex'

export function detectEngines(deps: DetectionDeps = realDeps()): Record<EngineName, string | null> {
  // claude / codex 均为自带版：只报随包二进制路径，不扫系统 PATH/NVM；下游 detectEngineVersion 据此显示
  // 捆绑版本（claude 2.1.x / codex 0.137.x），与 SDK 实际执行用的二进制一致、不依赖本机另装 CLI。
  // （detectBinary 仍保留——命令行工具检测 clitools 复用它扫系统 PATH。）
  return { claude: deps.resolveBundledClaude(), codex: deps.resolveBundledCodex() }
}
