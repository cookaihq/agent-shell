import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectEngineVersion } from './engineInfo'

export interface DetectionDeps {
  env: NodeJS.ProcessEnv
  home: string
  fileExists: (p: string) => boolean
  listDir: (p: string) => string[]
  /** 跑 `<bin> --version`，成功返回版本号、失败返回 null。用于在多个安装间挑「真能跑起来」的那个。 */
  probeVersion: (binPath: string) => string | null
}

function realDeps(): DetectionDeps {
  return {
    env: process.env,
    home: os.homedir(),
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
  }
}

/** 候选目录，按优先级：PATH → NVM 版本化 bin → Homebrew → 标准路径。 */
function candidateDirs(deps: DetectionDeps): string[] {
  const dirs: string[] = []
  // 1. PATH（GUI 进程常不继承 shell PATH，所以后面还有兜底）
  for (const d of (deps.env.PATH ?? '').split(path.delimiter)) if (d) dirs.push(d)
  // 2. NVM：~/.nvm/versions/node/<ver>/bin —— 不同 node 版本下可能装着【不同版本号】的同名 CLI，
  //    且 readdirSync 默认是旧版在前。按 node 版本号【降序】排，让最新版目录最先被检索（借鉴 open-design
  //    sortVersionedDirEntries），配合下面「第一个能跑的就用」即天然命中最新安装、且不必探测旧/坏的版本。
  const nvmRoot = path.join(deps.home, '.nvm', 'versions', 'node')
  for (const ver of sortNodeVersionDirsDesc(deps.listDir(nvmRoot))) dirs.push(path.join(nvmRoot, ver, 'bin'))
  // 3. Homebrew（Apple Silicon + Intel）
  dirs.push('/opt/homebrew/bin', '/usr/local/bin')
  // 4. 标准路径 + npm 全局
  dirs.push(path.join(deps.home, '.local', 'bin'), '/usr/bin', '/bin')
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

export function detectBinary(name: string, deps: DetectionDeps = realDeps()): string | null {
  // 同名 CLI 在不同 node 版本里可能是不同安装形态：①老 npm JS 脚本（shebang env node，须 PATH 有 node）
  // ②新原生自包含二进制 ③坏的悬空软链。所以不能「找到第一个文件就用」——要挑第一个真能跑出版本的。
  // 候选目录已把 nvm 各版本按版本号降序排（见 candidateDirs），故「第一个能跑的」天然是最新可用安装，
  // 既选对又快（命中即停，不必探测旧/坏版本）。同一路径只探测一次（PATH 与 nvm/兜底目录常重叠）。
  // 都跑不出版本时退回第一个存在的文件，让上层显示「找到但调用失败」而非误报「未检测到 CLI」。
  let firstExisting: string | null = null
  const seen = new Set<string>()
  for (const dir of candidateDirs(deps)) {
    const p = path.join(dir, name)
    if (seen.has(p)) continue
    seen.add(p)
    if (!deps.fileExists(p)) continue
    if (firstExisting === null) firstExisting = p
    if (deps.probeVersion(p) !== null) return p
  }
  return firstExisting
}

export type EngineName = 'claude' | 'codex'

export function detectEngines(deps: DetectionDeps = realDeps()): Record<EngineName, string | null> {
  return { claude: detectBinary('claude', deps), codex: detectBinary('codex', deps) }
}
