/**
 * CLI 工具安装/更新执行模块。
 *
 * - installTool：按 catalog 方式安装指定工具（阻塞 spawn，无 SSE/HTTP）
 * - updateTool：按账本记录推导更新命令并执行
 * - checkUpdates：检查 brew/npm/custom 已装工具的可用更新
 *
 * 依赖通过 InstallDeps 接口注入，store.ts 通过 upsertCustomTool/listCustomTools 注入，
 * 本模块不 import store.ts，保持与 Task 5 解耦。
 */

import { exec, execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import os from 'node:os'
import type { CustomCliTool, CliToolPlatform } from '@agent-shell/contracts'
import { CLI_TOOLS_CATALOG } from './catalog'
import { parseCliVersion, invalidateDetectCache as defaultInvalidateDetectCache } from './detect'
import { detectBinary as defaultDetectBinary } from '../runtimes/detection'

const execAsync = promisify(exec)
const execFileAsync = promisify(nodeExecFile)

// ── PATH 扩展 helper ─────────────────────────────────────────────────────────

/**
 * 扩展 PATH，把 GUI daemon 常缺的目录补上。
 * 参照 runtimes/detection.ts 的 candidateDirs 中常见目录。
 */
function buildExpandedPath(): string {
  const isWin = process.platform === 'win32'
  const sep = isWin ? ';' : ':'
  const home = os.homedir()
  const extra = isWin
    ? []
    : [
        '/opt/homebrew/bin',   // Apple Silicon Homebrew
        '/usr/local/bin',      // Intel Homebrew / 手动安装
        `${home}/.local/bin`,  // pipx / pip 用户目录
        '/usr/bin',
        '/bin',
      ]
  const current = process.env.PATH ?? ''
  // 把补充目录追加到末尾（PATH 本身可能已含某些目录，追加后去重由 OS 命令解析器处理）
  const parts = [current, ...extra].filter(Boolean)
  return parts.join(sep)
}

// ── 默认 runCommand ──────────────────────────────────────────────────────────

/**
 * 默认 runCommand：用 exec（默认走 shell）跑命令，扩展 PATH 以支持 GUI 进程缺 PATH 的场景。
 * 绝不抛出——安装失败/超时时从 err 兜底 code/stdout/stderr，让调用方检查 code。
 * maxBuffer 提到 10MB（brew install 输出可能 >1MB，默认 1MB 会杀子进程并截断 stderr 误导）；
 * timeout 10min 上限（超时被 catch 返回 code≠0，调用方按 ok:false 处理）。
 */
async function defaultRunCommand(
  command: string,
): Promise<{ code: number; stdout: string; stderr: string }> {
  const expandedPath = buildExpandedPath()
  try {
    const { stdout, stderr } = await execAsync(command, {
      env: { ...process.env, PATH: expandedPath },
      maxBuffer: 10 * 1024 * 1024,
      timeout: 600_000,
    })
    return { code: 0, stdout: stdout ?? '', stderr: stderr ?? '' }
  } catch (err: unknown) {
    const e = err as Record<string, unknown>
    return {
      code: typeof e['code'] === 'number' ? e['code'] : 1,
      stdout: typeof e['stdout'] === 'string' ? e['stdout'] : '',
      stderr: typeof e['stderr'] === 'string' ? e['stderr'] : '',
    }
  }
}

// ── 默认 probeVersion ────────────────────────────────────────────────────────

/**
 * 对已知路径的可执行文件跑 --version，解析版本号。
 * 失败（工具不存在、权限不足等）返回 null，不抛。
 */
async function defaultProbeVersion(binPath: string): Promise<string | null> {
  try {
    const { stdout, stderr } = await execFileAsync(binPath, ['--version'], {
      encoding: 'utf8',
      timeout: 5000,
    })
    return parseCliVersion((stdout ?? '') + '\n' + (stderr ?? ''))
  } catch (err: unknown) {
    // execFile 失败时可能 err.stdout/stderr 有内容（部分工具 --version exit code 非 0）
    const e = err as Record<string, unknown>
    const out = typeof e['stdout'] === 'string' ? e['stdout'] : ''
    const err2 = typeof e['stderr'] === 'string' ? e['stderr'] : ''
    if (out || err2) return parseCliVersion(out + '\n' + err2)
    return null
  }
}

// ── 依赖注入接口 ──────────────────────────────────────────────────────────────

export interface InstallDeps {
  /** 运行平台。默认 process.platform；测试可注入 'win32' 测 Windows 分支。 */
  platform: NodeJS.Platform
  /** 执行 shell 命令（安装/更新/outdated 检查）。绝不抛，返回 {code, stdout, stderr}。 */
  runCommand: (command: string) => Promise<{ code: number; stdout: string; stderr: string }>
  /** 扫 PATH 拿可执行绝对路径，或 null。默认 = runtimes/detection 的 detectBinary。 */
  detectBinary: (name: string) => string | null
  /** 对已知路径探测版本号。默认 = execFile <bin> --version → parseCliVersion。 */
  probeVersion: (binPath: string) => Promise<string | null>
  /** 清空检测缓存。默认 = detect.ts 的 invalidateDetectCache。 */
  invalidateDetectCache: () => void
  /**
   * 写安装账本元数据——由 service 注入。
   * 默认实现抛错（强制注入），install.ts 不 import store.ts。
   */
  upsertCustomTool: (tool: CustomCliTool) => void
  /**
   * 读账本自定义工具列表——由 service 注入。
   * 默认实现抛错（强制注入），install.ts 不 import store.ts。
   */
  listCustomTools: () => CustomCliTool[]
}

/**
 * 构造默认 deps。
 * platform/runCommand/detectBinary/probeVersion/invalidateDetectCache 有合理默认；
 * upsertCustomTool/listCustomTools 默认抛错，强制 service 注入。
 */
export function makeDefaultDeps(): InstallDeps {
  return {
    platform: process.platform,
    runCommand: defaultRunCommand,
    detectBinary: (name) => defaultDetectBinary(name),
    probeVersion: defaultProbeVersion,
    invalidateDetectCache: defaultInvalidateDetectCache,
    upsertCustomTool: () => { throw new Error('store must be injected: upsertCustomTool') },
    listCustomTools: () => { throw new Error('store must be injected: listCustomTools') },
  }
}

/** 合并用户传入的 Partial<InstallDeps> 与默认值 */
function mergeDeps(overrides?: Partial<InstallDeps>): InstallDeps {
  return { ...makeDefaultDeps(), ...overrides }
}

// ── 三个 helper（原样移植 CodePilot，仅改为 export）───────────────────────────

/**
 * 从安装命令推断包管理器类型。
 * 示例：'brew install jq' → 'brew'
 */
export function extractInstallMethod(command: string): string {
  const cmd = command.trim().toLowerCase()
  if (cmd.startsWith('brew ')) return 'brew'
  if (cmd.startsWith('npm ')) return 'npm'
  if (cmd.startsWith('pipx ')) return 'pipx'
  if (cmd.startsWith('pip ') || cmd.startsWith('pip3 ')) return 'pip'
  if (cmd.startsWith('cargo ')) return 'cargo'
  if (cmd.startsWith('apt ') || cmd.startsWith('apt-get ')) return 'apt'
  return 'unknown'
}

/**
 * 从安装命令提取包名（剥除 @版本 钉死）。
 * 示例：'npm install -g @e/cli' → '@e/cli'
 *       'pip install yt-dlp@1.2' → 'yt-dlp'
 */
export function extractPackageSpec(command: string): string | null {
  const parts = command.trim().split(/\s+/)
  const installIdx = parts.findIndex((p) => p === 'install')
  if (installIdx < 0) return null
  for (let i = installIdx + 1; i < parts.length; i++) {
    if (!parts[i].startsWith('-')) {
      return parts[i].replace(/@\d+.*$/, '') // 剥 @版本 钉死（如 @latest/@1.2）
    }
  }
  return null
}

/**
 * 根据包管理器类型和包名构造更新命令。
 * 示例：('brew', 'jq') → 'brew upgrade jq'
 * 未知方式返回 null。
 */
export function buildUpdateCommand(method: string, packageName: string): string | null {
  switch (method) {
    case 'brew':  return `brew upgrade ${packageName}`
    case 'npm':   return `npm update -g ${packageName}`
    case 'pipx':  return `pipx upgrade ${packageName}`
    case 'pip':   return `pip install --upgrade ${packageName}`
    case 'cargo': return `cargo install ${packageName}`
    case 'apt':   return `sudo apt-get install --only-upgrade ${packageName}`
    default:      return null
  }
}

// ── installTool（spec §A.5）──────────────────────────────────────────────────

/**
 * 安装 catalog 中的 CLI 工具。
 *
 * - 按 opts.method 指定方式，或取首个支持当前平台的安装方式
 * - 阻塞跑完命令，截断 output 到约 4000 字符（保留尾部，结果在末尾）
 * - 成功后写安装账本（upsertCustomTool）并使检测缓存失效
 *
 * @param id       catalog 中的工具 id
 * @param opts     可选：method 指定安装方式；description 工具描述
 * @param deps     依赖注入（测试替换）
 */
export async function installTool(
  id: string,
  opts?: { method?: string; description?: string },
  deps?: Partial<InstallDeps>,
): Promise<{ ok: boolean; output: string; version?: string | null }> {
  const d = mergeDeps(deps)

  // 1. 查 catalog
  const def = CLI_TOOLS_CATALOG.find((t) => t.id === id)
  if (!def) {
    return { ok: false, output: `未知工具: ${id}` }
  }

  // 2. 选安装方式
  // d.platform 是 NodeJS.Platform（含 'aix' 等），platforms 元素是 contracts 的 CliToolPlatform；
  // cast 收窄——运行时 includes 做字符串等值比较，d.platform 非三者之一时 find 返回 undefined，逻辑正确。
  let methodEntry: (typeof def.installMethods)[number] | undefined
  if (opts?.method) {
    methodEntry = def.installMethods.find((m) => m.method === opts.method)
  } else {
    methodEntry = def.installMethods.find((m) => m.platforms.includes(d.platform as CliToolPlatform))
  }
  if (!methodEntry) {
    return { ok: false, output: '当前系统无安装方式' }
  }

  // 3. 执行安装命令（阻塞）
  const { code, stdout, stderr } = await d.runCommand(methodEntry.command)

  // 合并输出，截断到约 4000 字符（保留尾部，因安装结果在末尾）
  const rawOutput = (stdout + '\n' + stderr).trim()
  const MAX_OUTPUT = 4000
  const output = rawOutput.length > MAX_OUTPUT
    ? '…' + rawOutput.slice(rawOutput.length - MAX_OUTPUT)
    : rawOutput

  // 4. 安装失败
  if (code !== 0) {
    return { ok: false, output }
  }

  // 5. 安装成功：探测二进制路径和版本
  const installMethod = extractInstallMethod(methodEntry.command)
  const installPackage = extractPackageSpec(methodEntry.command) ?? undefined

  let binPath = ''
  let binName = def.binNames[0]
  let version: string | null = null

  for (const bin of def.binNames) {
    const found = d.detectBinary(bin)
    if (found !== null) {
      binPath = found
      binName = bin
      version = await d.probeVersion(found)
      break
    }
  }

  // 6. 写安装账本
  d.upsertCustomTool({
    id: def.id,
    name: def.name,
    binName,
    binPath,
    version: version ?? null,
    installMethod,
    installPackage,
    description: opts?.description,
    createdAt: Date.now(),
  })

  // 7. 使检测缓存失效（下次 detectAllCliTools 重新扫）
  d.invalidateDetectCache()

  return { ok: true, output, version }
}

// ── updateTool（spec §A.6）──────────────────────────────────────────────────

/**
 * 更新已安装的 CLI 工具。
 *
 * - 优先从账本记录（installMethod/installPackage）推导更新命令
 * - 账本无记录时尝试 catalog（按 id 匹配，取首个平台支持的方式）
 * - 更新成功后重测版本、刷新账本、使缓存失效
 *
 * @param idOrName  工具 id 或 name
 * @param deps      依赖注入
 */
export async function updateTool(
  idOrName: string,
  deps?: Partial<InstallDeps>,
): Promise<{ ok: boolean; output: string; version?: string | null }> {
  const d = mergeDeps(deps)

  // 1. 从账本查（id 或 name 匹配）
  const customTools = d.listCustomTools()
  const existing = customTools.find(
    (ct) => ct.id === idOrName || ct.name === idOrName,
  )

  let method: string | undefined
  let pkg: string | undefined
  let knownBinPath: string | undefined
  let toolId = idOrName

  if (existing) {
    method = existing.installMethod
    pkg = existing.installPackage
    knownBinPath = existing.binPath || undefined
    toolId = existing.id
  } else {
    // 2. 账本无记录：尝试 catalog
    const def = CLI_TOOLS_CATALOG.find((t) => t.id === idOrName)
    if (!def) {
      return { ok: false, output: `未知工具: ${idOrName}（账本无记录，catalog 也未找到）` }
    }
    // 取首个支持当前平台的方式（同 installTool 的类型转换理由）
    const methodEntry = def.installMethods.find((m) => m.platforms.includes(d.platform as CliToolPlatform))
    if (methodEntry) {
      method = extractInstallMethod(methodEntry.command)
      pkg = extractPackageSpec(methodEntry.command) ?? undefined
    }
    toolId = def.id
  }

  // 3. 推导更新命令
  if (!method || !pkg) {
    return { ok: false, output: '无法推导更新命令（未知安装方式）' }
  }
  const updateCmd = buildUpdateCommand(method, pkg)
  if (!updateCmd) {
    return { ok: false, output: '无法推导更新命令（未知安装方式）' }
  }

  // 4. 执行更新命令（阻塞）
  const { code, stdout, stderr } = await d.runCommand(updateCmd)
  const rawOutput = (stdout + '\n' + stderr).trim()
  const MAX_OUTPUT = 4000
  const output = rawOutput.length > MAX_OUTPUT
    ? '…' + rawOutput.slice(rawOutput.length - MAX_OUTPUT)
    : rawOutput

  if (code !== 0) {
    return { ok: false, output }
  }

  // 5. 更新成功：重测版本
  let version: string | null = null

  if (knownBinPath) {
    version = await d.probeVersion(knownBinPath)
  }

  // 若已知路径探不到（或无路径），用 detectBinary 再找
  if (version === null) {
    const def = CLI_TOOLS_CATALOG.find((t) => t.id === toolId)
    const binsToProbe = def?.binNames ?? (existing ? [existing.binName] : [])
    for (const bin of binsToProbe) {
      const found = d.detectBinary(bin)
      if (found !== null) {
        version = await d.probeVersion(found)
        if (version !== null) { knownBinPath = found; break }
      }
    }
  }

  // 6. 刷新账本（若账本有记录则更新版本；否则写新记录）
  if (existing) {
    d.upsertCustomTool({
      ...existing,
      version: version ?? null,
      binPath: knownBinPath ?? existing.binPath,
    })
  } else {
    const def = CLI_TOOLS_CATALOG.find((t) => t.id === toolId)
    if (def) {
      d.upsertCustomTool({
        id: def.id,
        name: def.name,
        binName: def.binNames[0],
        binPath: knownBinPath ?? '',
        version: version ?? null,
        installMethod: method,
        installPackage: pkg,
        createdAt: Date.now(),
      })
    }
  }

  d.invalidateDetectCache()

  return { ok: true, output, version }
}

// ── checkUpdates（spec §A.6，移植 CodePilot cli-tools-mcp.ts line 625–733）──

/**
 * 检查已安装 CLI 工具的可用更新。
 *
 * 三路检查：
 * 1. brew outdated --json → 匹配 catalog
 * 2. npm outdated -g --json → 匹配 catalog 或 custom（installMethod==='npm'）
 * 3. 仅对 installMethod 为 'unknown'/'brew'/'npm' 的 custom 工具重测版本（其余 pipx/pip/cargo/apt 跳过）
 *
 * 每路失败均 try/catch 吞掉，不影响其他检查。
 * 返回结构化数组，text 化留给 Task 6 的 MCP handler。
 */
export async function checkUpdates(
  deps?: Partial<InstallDeps>,
): Promise<Array<{ name: string; id: string; current: string; latest?: string; method: string }>> {
  const d = mergeDeps(deps)
  const updates: Array<{ name: string; id: string; current: string; latest?: string; method: string }> = []

  // ── 1. brew outdated ────────────────────────────────────────────────────────
  try {
    const { stdout } = await d.runCommand('brew outdated --json')
    const parsed = JSON.parse(stdout)
    // 现代 Homebrew（实测 5.1.15）brew outdated --json 返回 {formulae:[...],casks:[...]}；
    // 兼容极旧版可能的扁平数组。CodePilot 源假设扁平数组，在新版会 TypeError 被吞、永不报告——此处修正。
    const formulae = (Array.isArray(parsed) ? parsed : (parsed?.formulae ?? [])) as Array<{
      name: string
      installed_versions: string[]
      current_version: string
    }>
    for (const pkg of formulae) {
      const catalogTool = CLI_TOOLS_CATALOG.find(
        (c) =>
          c.installMethods.some((m) => m.method === 'brew') &&
          (c.binNames.includes(pkg.name) || c.id === pkg.name),
      )
      if (catalogTool) {
        updates.push({
          name: catalogTool.name,
          id: catalogTool.id,
          current: pkg.installed_versions?.[0] ?? 'unknown',
          latest: pkg.current_version,
          method: 'brew',
        })
      }
    }
  } catch {
    // brew 未装或无过期包，忽略
  }

  // ── 2. npm outdated -g ──────────────────────────────────────────────────────
  try {
    const { stdout } = await d.runCommand('npm outdated -g --json')
    if (stdout.trim()) {
      const outdated = JSON.parse(stdout) as Record<
        string,
        { current: string; wanted: string; latest: string }
      >
      // hoist 出循环：custom 列表每次循环不变，取一次即可
      const npmCustomTools = d.listCustomTools()
      for (const [pkg, info] of Object.entries(outdated)) {
        // 优先匹配 catalog
        const catalogTool = CLI_TOOLS_CATALOG.find((c) =>
          c.installMethods.some((m) => m.method === 'npm' && m.command.includes(pkg)),
        )
        // 再匹配 custom（npm 报的是包名，不是 bin 名）
        const customTool = npmCustomTools.find(
          (ct) => ct.installMethod === 'npm' && (ct.installPackage === pkg || ct.binName === pkg),
        )
        if (catalogTool) {
          updates.push({
            name: catalogTool.name,
            id: catalogTool.id,
            current: info.current,
            latest: info.latest,
            method: 'npm',
          })
        } else if (customTool) {
          updates.push({
            name: customTool.name,
            id: customTool.id,
            current: info.current,
            latest: info.latest,
            method: 'npm',
          })
        }
      }
    }
  } catch {
    // npm 未装或无过期包，忽略
  }

  // ── 3. custom 工具重测版本（移植 CodePilot line 687-707）──
  // 仅对 unknown/brew/npm 的 custom 重测版本，其余（pipx/pip/cargo/apt）一律跳过——
  // 对齐 CodePilot：这些方式的"版本漂移"不等于"有新版可用"，有意不报告。
  const customTools = d.listCustomTools()
  for (const ct of customTools) {
    if (ct.installMethod !== 'unknown' && ct.installMethod !== 'brew' && ct.installMethod !== 'npm') continue
    if (!ct.binPath) continue
    try {
      const currentVersion = await d.probeVersion(ct.binPath)
      if (currentVersion && ct.version && currentVersion !== ct.version) {
        updates.push({
          name: ct.name,
          id: ct.id,
          current: ct.version,
          latest: currentVersion,
          method: ct.installMethod ?? 'unknown',
        })
      }
    } catch {
      // 工具已被删除，忽略
    }
  }

  return updates
}
