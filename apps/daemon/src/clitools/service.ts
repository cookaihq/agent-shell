/**
 * CLI 工具 service（重写版，去技能化）。
 *
 * 不再生成 SKILL.md（旧 skill.ts 已删）；改为「检测即可见 + agent 装」：
 *   - catalog()：返回内置目录常量。
 *   - installed()：本机检测结果 + custom 账本（去重，spec §A.2）+ platform。
 *   - list()：目录 + custom 的合并视图（MCP as_cli_list 用，同样去重）。
 *   - addCustom()/removeCustom()：按绝对路径登记 / 移除自定义工具。
 *   - install()/update()/checkUpdates()：委托 install.ts，并注入 store 的 upsert/list 作为 deps。
 *
 * store（cli-tools.json）既存「用户登记的工具」也存「目录工具被装后的安装账本」。
 */

import fs from 'node:fs'; import path from 'node:path'
import { execFile as nodeExecFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { CliToolDef, CliToolPlatform, CustomCliTool, InstalledResp, AddCustomCliToolReq } from '@agent-shell/contracts'
import { makeCliToolStore, type CliToolStore } from './store'
import { CLI_TOOLS_CATALOG } from './catalog'
import { detectAllCliTools, invalidateDetectCache, parseCliVersion } from './detect'
import { installTool, updateTool, checkUpdates, type InstallDeps } from './install'
import { cliToolsPath } from '../paths'

const execFileAsync = promisify(nodeExecFile)

export interface CliToolListRow {
  id: string
  name: string
  summary: string
  installed: boolean
  version: string | null
  custom: boolean
}

export interface CliToolService {
  /** 内置目录（12 工具）。 */
  catalog: () => CliToolDef[]
  /** 本机检测结果 + custom（去账本重）+ platform。 */
  installed: () => Promise<InstalledResp>
  /** 目录 + custom 合并视图（去账本重）。 */
  list: () => Promise<CliToolListRow[]>
  /** 按绝对路径登记自定义工具（校验可执行 + 探测版本）。 */
  addCustom: (req: AddCustomCliToolReq) => Promise<CustomCliTool>
  /** 移除自定义工具。 */
  removeCustom: (id: string) => void
  /** 安装目录工具（委托 install.ts）。 */
  install: (id: string, opts?: { method?: string; description?: string }) => Promise<{ ok: boolean; output: string; version?: string | null }>
  /** 更新工具（委托 install.ts）。 */
  update: (idOrName: string) => Promise<{ ok: boolean; output: string; version?: string | null }>
  /** 查可用更新（委托 install.ts）。 */
  checkUpdates: () => Promise<Array<{ name: string; id: string; current: string; latest?: string; method: string }>>
}

/**
 * 构造 CLI 工具 service。
 * toolsFile 缺省用 paths.ts（测试可注入隔离）。不再收 getSkillsDir（不生成 SKILL.md）。
 */
export function makeCliToolService(toolsFile: string = cliToolsPath()): CliToolService {
  const store: CliToolStore = makeCliToolStore(toolsFile)
  // 注入给 install.ts 的 deps：让 installTool/updateTool/checkUpdates 能读写本 store 的账本。
  // 其余 InstallDeps 字段（platform/runCommand/detectBinary/probeVersion/invalidateDetectCache）用 install.ts 默认。
  const cliDeps: Pick<InstallDeps, 'upsertCustomTool' | 'listCustomTools'> = {
    upsertCustomTool: store.upsert,
    listCustomTools: store.list,
  }

  /**
   * 求「被目录工具检测命中的 binPath 集合」。
   * custom 账本中 binPath 命中这些路径的记录 = 仅安装账本（目录工具装出来的），不作独立工具展示。
   */
  const catalogHitBinPaths = (detected: Awaited<ReturnType<typeof detectAllCliTools>>): Set<string> => {
    const catalogIds = new Set(CLI_TOOLS_CATALOG.map((c) => c.id))
    const hit = new Set<string>()
    for (const d of detected) {
      if (catalogIds.has(d.id) && d.binPath) hit.add(d.binPath)
    }
    return hit
  }

  /** 生成新的 custom 工具 id（与旧 service 一致的形态）。 */
  const genId = () => 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

  return {
    catalog: () => CLI_TOOLS_CATALOG,

    installed: async (): Promise<InstalledResp> => {
      const customs = store.list()
      const detected = await detectAllCliTools({ customTools: customs })
      const hit = catalogHitBinPaths(detected)
      // custom 列表剔除「binPath 命中某目录工具检测路径」的账本记录
      const custom = customs.filter((c) => !hit.has(c.binPath))
      return { detected, custom, platform: process.platform as CliToolPlatform }
    },

    list: async (): Promise<CliToolListRow[]> => {
      const customs = store.list()
      const detected = await detectAllCliTools({ customTools: customs })
      const byId = new Map(detected.map((d) => [d.id, d]))
      const hit = catalogHitBinPaths(detected)

      const rows: CliToolListRow[] = []
      // 目录工具：每个一行，installed/version 取检测结果
      for (const c of CLI_TOOLS_CATALOG) {
        const d = byId.get(c.id)
        rows.push({
          id: c.id,
          name: c.name,
          summary: c.summary,
          installed: d?.status === 'installed',
          version: d?.version ?? null,
          custom: false,
        })
      }
      // 非账本的 custom：每个一行（账本记录已被 hit 过滤，避免同工具重复出现）
      for (const ct of customs) {
        if (hit.has(ct.binPath)) continue
        const d = byId.get(ct.id)
        rows.push({
          id: ct.id,
          name: ct.name,
          summary: ct.description ?? '',
          installed: d?.status === 'installed',
          version: d?.version ?? ct.version ?? null,
          custom: true,
        })
      }
      return rows
    },

    addCustom: async (req): Promise<CustomCliTool> => {
      const { binPath, name, description } = req
      // 校验：绝对路径 + 是文件 + 可执行
      if (!path.isAbsolute(binPath)) {
        throw new Error(`binPath 必须是绝对路径：${binPath}`)
      }
      // 分三步校验，给出精确错误（避免把「是目录」误报成「路径不存在」）
      let stat: fs.Stats
      try { stat = fs.statSync(binPath) } catch { throw new Error(`路径不存在：${binPath}`) }
      if (!stat.isFile()) throw new Error(`不是文件（是目录或其他类型）：${binPath}`)
      try { fs.accessSync(binPath, fs.constants.X_OK) } catch { throw new Error(`没有执行权限：${binPath}`) }

      const binName = path.basename(binPath)
      // 已知绝对路径，直接 execFile --version 探测版本（失败则 null，不抛）
      let version: string | null = null
      try {
        const { stdout, stderr } = await execFileAsync(binPath, ['--version'], { encoding: 'utf8', timeout: 5000 })
        version = parseCliVersion((stdout ?? '') + '\n' + (stderr ?? ''))
      } catch (err: unknown) {
        const e = err as Record<string, unknown>
        const out = typeof e['stdout'] === 'string' ? e['stdout'] : ''
        const err2 = typeof e['stderr'] === 'string' ? e['stderr'] : ''
        if (out || err2) version = parseCliVersion(out + '\n' + err2)
      }

      const saved = store.upsert({
        id: genId(),
        name: name ?? binName,
        binName,
        binPath,
        version,
        description,
        createdAt: Date.now(),
      })
      invalidateDetectCache()
      return saved
    },

    removeCustom: (id) => { store.remove(id); invalidateDetectCache() },

    install: (id, opts) => installTool(id, opts, cliDeps),
    update: (idOrName) => updateTool(idOrName, cliDeps),
    checkUpdates: () => checkUpdates(cliDeps),
  }
}
