/**
 * CLI 工具检测模块。
 * 复用 runtimes/detection 的 detectBinary 扫 PATH/NVM/Homebrew，
 * 在此层做版本解析、catalog/EXTRA/custom 全量检测和模块级 TTL 缓存。
 */

import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CliToolDef, CliToolRuntimeInfo, CustomCliTool } from '@agent-shell/contracts'
import { detectBinary as defaultDetectBinary } from '../runtimes/detection'
import { CLI_TOOLS_CATALOG, EXTRA_WELL_KNOWN_BINS } from './catalog'

// promisify 只需创建一次，模块级复用（避免每次 defaultExecFile 调用都重建）
const execFileAsync = promisify(nodeExecFile)

// ── 类型：依赖注入接口 ────────────────────────────────────────────────────────

export interface DetectCliDeps {
  /** 扫 PATH/NVM/Homebrew/标准目录，返回可执行绝对路径或 null */
  detectBinary: (name: string) => string | null
  /** 执行 `file --version`，返回 stdout/stderr；失败时抛出带 stdout/stderr 的 Error */
  execFile: (file: string, args: string[]) => Promise<{ stdout: string; stderr: string }>
  /** 当前自定义工具列表，由 service 传入 */
  customTools: CustomCliTool[]
}

/** 默认 execFile：promisify 包装，退出码非 0 时从 err.stdout/stderr 兜底（不直接抛 null） */
const defaultExecFile: DetectCliDeps['execFile'] = async (file, args) => {
  try {
    const { stdout, stderr } = await execFileAsync(file, args, { encoding: 'utf8' })
    return { stdout: stdout ?? '', stderr: stderr ?? '' }
  } catch (err: unknown) {
    // child_process execFile 失败时 err 上带有 stdout/stderr（部分工具 --version 退出码非 0）
    const e = err as Record<string, unknown>
    return {
      stdout: typeof e['stdout'] === 'string' ? e['stdout'] : '',
      stderr: typeof e['stderr'] === 'string' ? e['stderr'] : '',
    }
  }
}

/** 默认 deps 工厂（每次调用返回新对象，customTools 默认空） */
function makeDefaultDeps(): DetectCliDeps {
  return {
    detectBinary: (name) => defaultDetectBinary(name),
    execFile: defaultExecFile,
    customTools: [],
  }
}

// ── 模块级缓存（TTL 120 秒）────────────────────────────────────────────────

const CACHE_TTL_MS = 120_000

let _cache: CliToolRuntimeInfo[] | null = null
let _cacheAt = 0

/** 清空检测缓存。install/update/add/remove 后由 service 调用。 */
export function invalidateDetectCache(): void {
  _cache = null
  _cacheAt = 0
}

// ── parseCliVersion：导出纯函数，供单测 ────────────────────────────────────

/**
 * 从版本命令输出（stdout + stderr 合并）解析版本字符串。
 * 1. 正则匹配第一个 \d+\.\d+[\w.-]* 段
 * 2. JSON.parse → .version 字段（字符串）
 * 3. 无→ null
 */
export function parseCliVersion(output: string): string | null {
  // 1. 正则匹配（如 "jq-1.7.1" → "1.7.1"，"ffmpeg version 6.1.2" → "6.1.2"）
  const m = /(\d+\.\d+[\w.-]*)/.exec(output)
  if (m) return m[1]

  // 2. JSON.parse → .version
  try {
    const obj = JSON.parse(output.trim())
    if (obj && typeof obj === 'object' && typeof obj['version'] === 'string') {
      return obj['version']
    }
  } catch {
    // 不是合法 JSON，忽略
  }

  return null
}

// ── detectCliTool ─────────────────────────────────────────────────────────────

/**
 * 检测一个工具所需的最小输入：只读 id/name/binNames 字段值。
 * 用普通 string[] 而非 CliToolDef 的非空元组——因为本函数同时服务于 catalog 的真
 * CliToolDef、EXTRA 元组临时拼的 def、custom 工具临时拼的 def，后两者 binNames 是普通数组。
 * 真 CliToolDef 的 binNames（[string,...string[]]）是 string[] 的子类型，可直接传入。
 */
export interface DetectableTool {
  id: string
  name: string
  binNames: string[]
}

/**
 * 检测单个 CLI 工具的本机安装状态。
 * 遍历 def.binNames，任一命中即返回 installed；全部未找到返回 not_installed。
 */
export async function detectCliTool(
  def: DetectableTool,
  deps?: Partial<DetectCliDeps>,
): Promise<CliToolRuntimeInfo> {
  const merged: DetectCliDeps = { ...makeDefaultDeps(), ...deps }

  for (const binName of def.binNames) {
    const binPath = merged.detectBinary(binName)
    if (binPath === null) continue

    // 可执行存在：跑 --version 解析版本（失败也返回 installed，version=null）
    let version: string | null = null
    try {
      const { stdout, stderr } = await merged.execFile(binPath, ['--version'])
      version = parseCliVersion(stdout + '\n' + stderr)
    } catch (err: unknown) {
      // execFile 抛出时（如退出码非 0 且调用方未做兜底），尝试从 err.stdout/stderr 解析版本
      const e = err as Record<string, unknown>
      const fallbackOut = typeof e['stdout'] === 'string' ? e['stdout'] : ''
      const fallbackErr = typeof e['stderr'] === 'string' ? e['stderr'] : ''
      if (fallbackOut || fallbackErr) {
        version = parseCliVersion(fallbackOut + '\n' + fallbackErr)
      }
      // 否则 version 保持 null
    }

    return { id: def.id, status: 'installed', version, binPath }
  }

  return { id: def.id, status: 'not_installed', version: null, binPath: null }
}

// ── detectAllCliTools ─────────────────────────────────────────────────────────

/**
 * 检测全部工具：catalog(12) + EXTRA(20) + deps.customTools。
 * 结果有模块级缓存，120s 内直接返回缓存，不重新调 detectBinary。
 */
export async function detectAllCliTools(
  deps?: Partial<DetectCliDeps>,
): Promise<CliToolRuntimeInfo[]> {
  // 缓存有效：直接返回（不更新 deps.customTools，因为 TTL 内以缓存为准）
  if (_cache !== null && Date.now() - _cacheAt < CACHE_TTL_MS) {
    return _cache
  }

  const merged: DetectCliDeps = { ...makeDefaultDeps(), ...deps }

  const results: CliToolRuntimeInfo[] = []

  // 以下三段均为串行 for...of await——有意选择，不用 Promise.all：
  // 结果有 120s 缓存，冷扫描成本被摊销，无需靠并发加速；串行也避免一次性 spawn 数十个
  // `<bin> --version` 子进程带来的并发压力。
  // 1. catalog 全 12 个工具
  for (const def of CLI_TOOLS_CATALOG) {
    results.push(await detectCliTool(def, merged))
  }

  // 2. EXTRA 全 20 个常见工具（[id, name, bin] 元组）
  for (const [id, name, bin] of EXTRA_WELL_KNOWN_BINS) {
    const fakeDef = { id, name, binNames: [bin] }
    results.push(await detectCliTool(fakeDef, merged))
  }

  // 3. 自定义工具
  for (const custom of merged.customTools) {
    const fakeDef = { id: custom.id, name: custom.name, binNames: [custom.binName] }
    results.push(await detectCliTool(fakeDef, merged))
  }

  // 写入缓存
  _cache = results
  _cacheAt = Date.now()

  return results
}
