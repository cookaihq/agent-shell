import { describe, it, expect } from 'vitest'
import type { InstalledResp, CliToolRuntimeInfo, CustomCliTool, CliToolPlatform } from '@agent-shell/contracts'
import { buildCliToolsContext } from '../context'
import { CLI_TOOLS_CATALOG } from '../catalog'

// 取真实 catalog summary 做断言（避免硬编码漂移）
const JQ_SUMMARY = CLI_TOOLS_CATALOG.find((c) => c.id === 'jq')!.summary
const JQ_NAME = CLI_TOOLS_CATALOG.find((c) => c.id === 'jq')!.name        // 'jq'
const FFMPEG_SUMMARY = CLI_TOOLS_CATALOG.find((c) => c.id === 'ffmpeg')!.summary
const FFMPEG_NAME = CLI_TOOLS_CATALOG.find((c) => c.id === 'ffmpeg')!.name // 'FFmpeg'

// ── 构造 mock 用小工厂 ────────────────────────────────────────────────────────
const det = (id: string, status: 'installed' | 'not_installed', version: string | null, binPath: string | null = null): CliToolRuntimeInfo =>
  ({ id, status, version, binPath })

const cus = (over: Partial<CustomCliTool> & { id: string; name: string }): CustomCliTool => ({
  binName: over.name,
  binPath: '/usr/local/bin/' + over.name,
  version: null,
  createdAt: 0,
  ...over,
})

const resp = (detected: CliToolRuntimeInfo[], custom: CustomCliTool[]): InstalledResp =>
  ({ detected, custom, platform: 'darwin' as CliToolPlatform })

describe('buildCliToolsContext', () => {
  it('catalog 已装工具进块（名字+版本+summary），未装的不进', () => {
    const out = buildCliToolsContext(resp(
      [det('jq', 'installed', '1.7', '/usr/bin/jq'), det('ffmpeg', 'not_installed', null)],
      [],
    ))
    expect(out).not.toBeNull()
    expect(out).toContain(`- ${JQ_NAME} (v1.7): ${JQ_SUMMARY}`)
    // ffmpeg 未装 → 不出现（连名字都没有）
    expect(out).not.toContain(FFMPEG_NAME)
  })

  it('custom 工具：有 description → 名字+版本+描述；无 description → 仅名字+版本', () => {
    const withDesc = buildCliToolsContext(resp([], [
      cus({ id: 'c_1', name: 'mytool', version: '2.0', description: '我的专用工具' }),
    ]))
    expect(withDesc).toContain('- mytool (v2.0): 我的专用工具')

    const noDesc = buildCliToolsContext(resp([], [
      cus({ id: 'c_2', name: 'baretool', version: '3.1' }),
    ]))
    expect(noDesc).toContain('- baretool (v3.1)')
    // 无 description 不应带冒号描述段
    expect(noDesc).not.toContain('baretool (v3.1):')
  })

  it('EXTRA 已装工具进块（仅名字+版本，无 summary 冒号段）', () => {
    const out = buildCliToolsContext(resp(
      [det('wget', 'installed', '1.21.4', '/usr/bin/wget')],
      [],
    ))
    expect(out).toContain('- wget (v1.21.4)')
    expect(out).not.toContain('wget (v1.21.4):')   // EXTRA 无描述 → 走「仅名字」分支
  })

  it('无版本 → 名字后不带 (vX)', () => {
    const out = buildCliToolsContext(resp(
      [det('jq', 'installed', null, '/usr/bin/jq')],
      [],
    ))
    expect(out).toContain(`- ${JQ_NAME}: ${JQ_SUMMARY}`)
    expect(out).not.toContain('(v')
  })

  it('去重：detected 出现两条同 id（catalog + 账本 custom，都 installed）→ 该工具只出现一次', () => {
    const out = buildCliToolsContext(resp(
      [det('jq', 'installed', '1.7', '/usr/bin/jq'), det('jq', 'installed', '1.7', '/usr/bin/jq')],
      [],
    ))!
    const occurrences = out.split('\n').filter((l) => l.startsWith(`- ${JQ_NAME}`)).length
    expect(occurrences).toBe(1)
  })

  it('detected 命中的 catalog id 与 custom 账本同 id → custom 不重复追加', () => {
    // jq 既在 detected（catalog 命中），又在 custom（账本残留同 id）→ 只出现一次
    const out = buildCliToolsContext(resp(
      [det('jq', 'installed', '1.7', '/usr/bin/jq')],
      [cus({ id: 'jq', name: 'jq', version: '1.7', description: '账本描述' })],
    ))!
    const occurrences = out.split('\n').filter((l) => l.startsWith('- jq')).length
    expect(occurrences).toBe(1)
    // 走 catalog 分支（summary），不应是账本 description
    expect(out).toContain(`- jq (v1.7): ${JQ_SUMMARY}`)
    expect(out).not.toContain('账本描述')
  })

  it('detected 含非 catalog 非 EXTRA 的 id（installed）→ 跳过不进块', () => {
    const out = buildCliToolsContext(resp(
      [det('totally-unknown-bin', 'installed', '9.9', '/x/y')],
      [],
    ))
    expect(out).toBeNull()
  })

  it('无任何已装（detected 全 not_installed 且 custom 空）→ 返回 null', () => {
    const out = buildCliToolsContext(resp(
      [det('jq', 'not_installed', null), det('ffmpeg', 'not_installed', null)],
      [],
    ))
    expect(out).toBeNull()
  })

  it('头尾标签 + 提示行逐行匹配', () => {
    const out = buildCliToolsContext(resp(
      [det('jq', 'installed', '1.7', '/usr/bin/jq')],
      [],
    ))!
    const lines = out.split('\n')
    expect(lines[0]).toBe('<available_cli_tools>')
    expect(lines[1]).toBe('以下命令行工具已安装、可直接调用：')
    expect(lines[lines.length - 1]).toBe('</available_cli_tools>')
  })

  it('三类混合（catalog + EXTRA + custom）都已装 → 各出现一次，顺序为 detected 先于 custom', () => {
    const out = buildCliToolsContext(resp(
      [det('jq', 'installed', '1.7', '/usr/bin/jq'), det('wget', 'installed', '1.21', '/usr/bin/wget')],
      [cus({ id: 'c_x', name: 'mytool', version: '1.0', description: '自定义' })],
    ))!
    expect(out).toContain(`- ${JQ_NAME} (v1.7): ${JQ_SUMMARY}`)
    expect(out).toContain('- wget (v1.21)')
    expect(out).toContain('- mytool (v1.0): 自定义')
    // custom 排在 detected 之后
    expect(out.indexOf('mytool')).toBeGreaterThan(out.indexOf('wget'))
  })
})
