/**
 * CLI 工具 service 单元测试（TDD，重写版）。
 *
 * service 已去技能化（不再生成 SKILL.md）：
 *   - catalog()/installed()/list()：目录 + 本机检测合并视图（含「安装账本」去重，spec §A.2）
 *   - addCustom()/removeCustom()：按绝对路径登记 / 移除自定义工具（账本即 cli-tools.json 的 custom）
 *   - install()/update()/checkUpdates()：委托 install.ts，并注入 store 的 upsert/list deps
 *
 * detect.ts / install.ts 通过 vi.mock 替身，store 用临时文件隔离（不触真实系统）。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import type { CliToolRuntimeInfo } from '@agent-shell/contracts'
import { CLI_TOOLS_CATALOG } from '../catalog'
import { libraryManifestPath } from '../../paths'

// ── mock detect.ts：detectAllCliTools 返回值由各用例控制 ───────────────────────
const detectAllMock = vi.fn<() => Promise<CliToolRuntimeInfo[]>>()
const invalidateMock = vi.fn()
vi.mock('../detect', () => ({
  detectAllCliTools: () => detectAllMock(),
  invalidateDetectCache: () => invalidateMock(),
  // addCustom 探测版本用：默认返回一个版本，个别用例可覆盖
  parseCliVersion: (s: string) => { const m = /(\d+\.\d+[\w.-]*)/.exec(s); return m ? m[1] : null },
}))

// ── mock install.ts：断言委托 + 入参透传 ──────────────────────────────────────
const installToolMock = vi.fn().mockResolvedValue({ ok: true, output: 'installed', version: '1.0.0' })
const updateToolMock = vi.fn().mockResolvedValue({ ok: true, output: 'updated', version: '2.0.0' })
const checkUpdatesMock = vi.fn().mockResolvedValue([])
vi.mock('../install', () => ({
  installTool: (...args: unknown[]) => installToolMock(...args),
  updateTool: (...args: unknown[]) => updateToolMock(...args),
  checkUpdates: (...args: unknown[]) => checkUpdatesMock(...args),
}))

// service 在 mock 之后再 import（确保拿到替身）
import { makeCliToolService } from '../service'

let dir: string, toolsFile: string
let svc: ReturnType<typeof makeCliToolService>

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'clit-'))
  toolsFile = path.join(dir, 'cli-tools.json')
  svc = makeCliToolService(toolsFile)
  detectAllMock.mockReset().mockResolvedValue([])
  invalidateMock.mockReset()
  installToolMock.mockClear()
  updateToolMock.mockClear()
  checkUpdatesMock.mockClear()
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const FFMPEG = CLI_TOOLS_CATALOG.find((c) => c.id === 'ffmpeg')!
const JQ = CLI_TOOLS_CATALOG.find((c) => c.id === 'jq')!

describe('cli tool service · catalog', () => {
  it('catalog() 返回全部 12 个内置工具', () => {
    const cat = svc.catalog()
    expect(cat).toBe(CLI_TOOLS_CATALOG)
    expect(cat.length).toBe(12)
  })
})

describe('cli tool service · list 合并视图', () => {
  it('list() = catalog 每个一行 + 已装状态来自 detected', async () => {
    detectAllMock.mockResolvedValue([
      { id: 'jq', status: 'installed', version: '1.7.1', binPath: '/opt/homebrew/bin/jq' },
      { id: 'ffmpeg', status: 'not_installed', version: null, binPath: null },
    ])
    const rows = await svc.list()
    const jqRow = rows.find((r) => r.id === 'jq')!
    const ffRow = rows.find((r) => r.id === 'ffmpeg')!
    expect(jqRow).toMatchObject({ id: 'jq', name: 'jq', installed: true, version: '1.7.1', custom: false })
    expect(jqRow.summary).toBe(JQ.summary)
    expect(ffRow).toMatchObject({ id: 'ffmpeg', installed: false, version: null, custom: false })
    // catalog 全 12 个都在
    for (const c of CLI_TOOLS_CATALOG) expect(rows.some((r) => r.id === c.id)).toBe(true)
  })

  it('list() 含非账本 custom 工具（custom:true 一行）', async () => {
    // 先登记一个真实可执行（用 node 自身）为自定义工具
    svc = makeCliToolService(toolsFile)
    const nodeBin = process.execPath
    detectAllMock.mockResolvedValue([])
    await svc.addCustom({ binPath: nodeBin, name: '我的工具', description: '一句话' })
    // detected 里给该 custom 一个 not_installed/installed 记录都行，关键看 list 是否把它当独立工具列出
    detectAllMock.mockResolvedValue([])
    const rows = await svc.list()
    const mine = rows.find((r) => r.custom && r.name === '我的工具')!
    expect(mine).toBeTruthy()
    expect(mine.summary).toBe('一句话')
  })
})

describe('cli tool service · 去重（spec §A.2 安装账本不重复展示）', () => {
  it('custom 记录 binPath 命中某目录工具检测路径 → installed().custom 剔除该账本', async () => {
    // 模拟：ffmpeg 被 as_cli_install 装过，账本里写了一条 binPath=/opt/homebrew/bin/ffmpeg
    // detectAllCliTools 让 ffmpeg(catalog) detected.binPath = 同值
    const FF_PATH = '/opt/homebrew/bin/ffmpeg'
    // 直接写一个账本文件（含该 custom 记录）
    fs.writeFileSync(toolsFile, JSON.stringify({
      custom: [{ id: 'ffmpeg', name: 'FFmpeg', binName: 'ffmpeg', binPath: FF_PATH, version: '6.1', installMethod: 'brew', createdAt: 1 }],
    }))
    svc = makeCliToolService(toolsFile)
    detectAllMock.mockResolvedValue([
      { id: 'ffmpeg', status: 'installed', version: '6.1', binPath: FF_PATH },
    ])
    const inst = await svc.installed()
    // 账本记录被过滤：custom 数组里不含该 ffmpeg 账本
    expect(inst.custom.some((c) => c.id === 'ffmpeg')).toBe(false)
    expect(inst.platform).toBe(process.platform)
    // detected 仍完整（ffmpeg 在 detected 里）
    expect(inst.detected.some((d) => d.id === 'ffmpeg')).toBe(true)
  })

  it('list()：账本命中目录工具路径时该工具只出现一次（catalog 行，非另起 custom 行）', async () => {
    const FF_PATH = '/opt/homebrew/bin/ffmpeg'
    fs.writeFileSync(toolsFile, JSON.stringify({
      custom: [{ id: 'ffmpeg', name: 'FFmpeg', binName: 'ffmpeg', binPath: FF_PATH, version: '6.1', installMethod: 'brew', createdAt: 1 }],
    }))
    svc = makeCliToolService(toolsFile)
    detectAllMock.mockResolvedValue([
      { id: 'ffmpeg', status: 'installed', version: '6.1', binPath: FF_PATH },
    ])
    const rows = await svc.list()
    const ffRows = rows.filter((r) => r.id === 'ffmpeg' || r.name === 'FFmpeg')
    expect(ffRows.length).toBe(1)
    expect(ffRows[0].custom).toBe(false)       // 是 catalog 行
    expect(ffRows[0].installed).toBe(true)
  })

  it('真正独立的 custom（binPath 不命中任何目录工具）→ installed().custom 保留', async () => {
    const MY_PATH = '/usr/local/bin/my-tool'
    fs.writeFileSync(toolsFile, JSON.stringify({
      custom: [{ id: 'c_abc', name: 'my-tool', binName: 'my-tool', binPath: MY_PATH, version: '0.1', createdAt: 1 }],
    }))
    svc = makeCliToolService(toolsFile)
    // detected 里也含该 custom（detectAll 检测 customTools），但其 id 不在 catalogIds → 不被过滤
    detectAllMock.mockResolvedValue([
      { id: 'ffmpeg', status: 'not_installed', version: null, binPath: null },
      { id: 'c_abc', status: 'installed', version: '0.1', binPath: MY_PATH },
    ])
    const inst = await svc.installed()
    expect(inst.custom.some((c) => c.id === 'c_abc')).toBe(true)
  })
})

describe('cli tool service · addCustom / removeCustom', () => {
  it('addCustom 写一条 custom（id 生成、binName=basename、探测 version）', async () => {
    const nodeBin = process.execPath
    const saved = await svc.addCustom({ binPath: nodeBin, description: 'JS 运行时' })
    expect(saved.id).toBeTruthy()
    expect(saved.binName).toBe(path.basename(nodeBin))
    expect(saved.name).toBe(path.basename(nodeBin))   // 未给 name → 用 binName
    expect(saved.binPath).toBe(nodeBin)
    expect(saved.description).toBe('JS 运行时')
    expect(typeof saved.createdAt).toBe('number')
    // version 探测到了（node --version 形如 v20.x → 解析出 20.x）
    expect(saved.version).toBeTruthy()
    // 落盘
    expect((fs.statSync(toolsFile).mode & 0o777)).toBe(0o600)
    const onDisk = JSON.parse(fs.readFileSync(toolsFile, 'utf8')) as { custom: Array<{ id: string }> }
    expect(onDisk.custom.map((c) => c.id)).toContain(saved.id)
    // 探测缓存被清
    expect(invalidateMock).toHaveBeenCalled()
  })

  it('addCustom 给了 name → 用传入 name', async () => {
    const saved = await svc.addCustom({ binPath: process.execPath, name: '别名' })
    expect(saved.name).toBe('别名')
  })

  it('addCustom 非绝对路径 → 抛错', async () => {
    await expect(svc.addCustom({ binPath: 'node' })).rejects.toThrow()
  })

  it('addCustom 路径不存在 / 不可执行 → 抛错', async () => {
    await expect(svc.addCustom({ binPath: '/definitely/not/here/xyz-bin' })).rejects.toThrow()
  })

  it('removeCustom 删 custom + 清缓存', async () => {
    const saved = await svc.addCustom({ binPath: process.execPath })
    invalidateMock.mockClear()
    svc.removeCustom(saved.id)
    const onDisk = JSON.parse(fs.readFileSync(toolsFile, 'utf8')) as { custom: unknown[] }
    expect(onDisk.custom).toEqual([])
    expect(invalidateMock).toHaveBeenCalled()
  })
})

describe('cli tool service · install/update/checkUpdates 委托 install.ts', () => {
  it('install 委托 installTool，透传 id+opts(含 description)，并注入 store deps', async () => {
    const ret = await svc.install('jq', { method: 'brew', description: 'JSON 处理器' })
    expect(ret).toEqual({ ok: true, output: 'installed', version: '1.0.0' })
    expect(installToolMock).toHaveBeenCalledTimes(1)
    const [id, opts, deps] = installToolMock.mock.calls[0]
    expect(id).toBe('jq')
    expect(opts).toEqual({ method: 'brew', description: 'JSON 处理器' })
    // 注入了 store 的 upsert/list
    expect(typeof (deps as Record<string, unknown>).upsertCustomTool).toBe('function')
    expect(typeof (deps as Record<string, unknown>).listCustomTools).toBe('function')
  })

  it('install 注入的 upsertCustomTool 真写进 store（installTool 调它即落盘）', async () => {
    // 让 installTool mock 调用注入的 upsertCustomTool 模拟「安装成功写账本」
    installToolMock.mockImplementationOnce(async (_id: string, _opts: unknown, deps: Record<string, unknown>) => {
      ;(deps.upsertCustomTool as (t: unknown) => void)({
        id: 'jq', name: 'jq', binName: 'jq', binPath: '/opt/homebrew/bin/jq', version: '1.7', installMethod: 'brew', createdAt: Date.now(),
      })
      return { ok: true, output: 'ok', version: '1.7' }
    })
    await svc.install('jq')
    const onDisk = JSON.parse(fs.readFileSync(toolsFile, 'utf8')) as { custom: Array<{ id: string }> }
    expect(onDisk.custom.map((c) => c.id)).toContain('jq')
  })

  it('update 委托 updateTool，透传 idOrName + 注入 deps', async () => {
    const ret = await svc.update('jq')
    expect(ret).toEqual({ ok: true, output: 'updated', version: '2.0.0' })
    expect(updateToolMock).toHaveBeenCalledTimes(1)
    const [idOrName, deps] = updateToolMock.mock.calls[0]
    expect(idOrName).toBe('jq')
    expect(typeof (deps as Record<string, unknown>).listCustomTools).toBe('function')
  })

  it('checkUpdates 委托 checkUpdates + 注入 deps', async () => {
    checkUpdatesMock.mockResolvedValueOnce([{ name: 'jq', id: 'jq', current: '1.6', latest: '1.7', method: 'brew' }])
    const ret = await svc.checkUpdates()
    expect(ret).toEqual([{ name: 'jq', id: 'jq', current: '1.6', latest: '1.7', method: 'brew' }])
    expect(checkUpdatesMock).toHaveBeenCalledTimes(1)
    const [deps] = checkUpdatesMock.mock.calls[0]
    expect(typeof (deps as Record<string, unknown>).listCustomTools).toBe('function')
  })
})

describe('cli tool service · 旧 {added} 文件兼容（迁移，spec §7）', () => {
  it('读旧 {added:[...]} 文件 → custom 视为空、不崩', async () => {
    fs.writeFileSync(toolsFile, JSON.stringify({
      added: [{ id: 'yt-dlp', name: 'yt-dlp', cmd: 'yt-dlp', custom: false }],
    }))
    svc = makeCliToolService(toolsFile)
    detectAllMock.mockResolvedValue([])
    const inst = await svc.installed()
    expect(inst.custom).toEqual([])
    // list 也不崩
    const rows = await svc.list()
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('cli tool service · 不再生成 SKILL.md', () => {
  it('addCustom 后 toolsFile 同目录下不产生任何 cli-* 技能目录', async () => {
    await svc.addCustom({ binPath: process.execPath })
    // service 不再碰 skillsDir：临时目录里只有 cli-tools.json，无 cli-* 目录
    const entries = fs.readdirSync(dir)
    expect(entries.some((e) => e.startsWith('cli-') && e !== 'cli-tools.json')).toBe(false)
  })
})

// ── cleanupLegacyCliToolSkills（启动清理，spec §7）──
import { cleanupLegacyCliToolSkills } from '../cleanup'

describe('cleanupLegacyCliToolSkills', () => {
  it('删 sourceId=cli-tools 的 manifest 条目 + 目录，保留普通技能', () => {
    const skillsDir = path.join(dir, 'skills')
    fs.mkdirSync(path.join(skillsDir, 'cli-yt-dlp'), { recursive: true })
    fs.writeFileSync(path.join(skillsDir, 'cli-yt-dlp', 'SKILL.md'), 'old')
    fs.mkdirSync(path.join(skillsDir, 'normal-skill'), { recursive: true })
    fs.writeFileSync(path.join(skillsDir, 'normal-skill', 'SKILL.md'), 'keep')
    fs.writeFileSync(libraryManifestPath(skillsDir), JSON.stringify({
      'cli-yt-dlp': { sourceId: 'cli-tools', name: 'yt-dlp', relPath: 'yt-dlp' },
      'normal-skill': { sourceId: 'git-x', name: 'normal', relPath: 'normal-skill' },
    }))

    cleanupLegacyCliToolSkills(skillsDir)

    const m = JSON.parse(fs.readFileSync(libraryManifestPath(skillsDir), 'utf8')) as Record<string, unknown>
    expect(m['cli-yt-dlp']).toBeUndefined()
    expect(m['normal-skill']).toBeTruthy()
    expect(fs.existsSync(path.join(skillsDir, 'cli-yt-dlp'))).toBe(false)
    expect(fs.existsSync(path.join(skillsDir, 'normal-skill'))).toBe(true)
  })

  it('无 cli-tools 条目时不写盘、不报错（manifest 原样）', () => {
    const skillsDir = path.join(dir, 'skills2')
    fs.mkdirSync(skillsDir, { recursive: true })
    const manifest = { 'normal-skill': { sourceId: 'git-x', name: 'normal', relPath: 'normal-skill' } }
    fs.writeFileSync(libraryManifestPath(skillsDir), JSON.stringify(manifest))
    expect(() => cleanupLegacyCliToolSkills(skillsDir)).not.toThrow()
    const m = JSON.parse(fs.readFileSync(libraryManifestPath(skillsDir), 'utf8'))
    expect(m).toEqual(manifest)
  })

  it('manifest 不存在 → 静默 return，不报错', () => {
    const skillsDir = path.join(dir, 'skills3')
    expect(() => cleanupLegacyCliToolSkills(skillsDir)).not.toThrow()
  })
})
