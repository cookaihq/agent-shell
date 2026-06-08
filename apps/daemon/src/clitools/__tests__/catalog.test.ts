import { describe, it, expect } from 'vitest'
import { CLI_TOOLS_CATALOG, EXTRA_WELL_KNOWN_BINS } from '../catalog'
import { CliToolDef } from '@agent-shell/contracts'

// 期望的 12 个工具 id（按顺序）
const EXPECTED_IDS = ['ffmpeg', 'jq', 'ripgrep', 'yt-dlp', 'pandoc', 'imagemagick', 'gws', 'elevenlabs', 'stripe', 'ncm-cli', 'dreamina', 'lark-cli']

describe('CLI_TOOLS_CATALOG', () => {
  it('恰好 12 个工具且每个工具结构合法（可通过 CliToolDef.parse）', () => {
    expect(CLI_TOOLS_CATALOG.length).toBe(12)
    for (const t of CLI_TOOLS_CATALOG) {
      expect(() => CliToolDef.parse(t)).not.toThrow()
    }
  })

  it('每个工具至少一个 installMethod 且 friendliness 在 0..5 范围内', () => {
    for (const t of CLI_TOOLS_CATALOG) {
      expect(t.installMethods.length).toBeGreaterThan(0)
      expect(t.friendliness).toBeGreaterThanOrEqual(0)
      expect(t.friendliness).toBeLessThanOrEqual(5)
    }
  })

  it('工具 id 全部唯一', () => {
    const ids = CLI_TOOLS_CATALOG.map(t => t.id)
    const unique = new Set(ids)
    expect(unique.size).toBe(12)
  })

  it('12 个工具 id 完全吻合预期列表（顺序一致）', () => {
    const ids = CLI_TOOLS_CATALOG.map(t => t.id)
    expect(ids).toEqual(EXPECTED_IDS)
  })

  it('所有工具 custom 均为 false', () => {
    for (const t of CLI_TOOLS_CATALOG) {
      expect(t.custom).toBe(false)
    }
  })

  it('所有工具 summary/detailIntro 非空（有 zh 内容）', () => {
    for (const t of CLI_TOOLS_CATALOG) {
      expect(t.summary.length).toBeGreaterThan(0)
      expect(t.detailIntro.length).toBeGreaterThan(0)
    }
  })

  it('所有工具 useCases/guideSteps 均非空数组', () => {
    for (const t of CLI_TOOLS_CATALOG) {
      expect(t.useCases.length).toBeGreaterThan(0)
      expect(t.guideSteps.length).toBeGreaterThan(0)
    }
  })

  it('不包含 en 字段（summaryEn/setupType/postInstallCommands/healthCheckCommand 等）', () => {
    for (const t of CLI_TOOLS_CATALOG) {
      const raw = t as Record<string, unknown>
      expect(raw['summaryEn']).toBeUndefined()
      expect(raw['setupType']).toBeUndefined()
      expect(raw['postInstallCommands']).toBeUndefined()
      expect(raw['healthCheckCommand']).toBeUndefined()
      expect(raw['supportsAutoDescribe']).toBeUndefined()
      expect(raw['agentFriendly']).toBeUndefined()
      expect(raw['supportsJson']).toBeUndefined()
      expect(raw['supportsSchema']).toBeUndefined()
      expect(raw['supportsDryRun']).toBeUndefined()
      expect(raw['contextFriendly']).toBeUndefined()
    }
  })

  it('friendliness 逐工具核对计分', () => {
    const scores: Record<string, number> = {
      ffmpeg: 0,
      jq: 1,
      ripgrep: 1,
      'yt-dlp': 1,
      pandoc: 0,
      imagemagick: 0,
      gws: 5,
      elevenlabs: 2,
      stripe: 2,
      'ncm-cli': 1,
      dreamina: 2,
      'lark-cli': 5,
    }
    for (const t of CLI_TOOLS_CATALOG) {
      expect(t.friendliness).toBe(scores[t.id])
    }
  })
})

describe('EXTRA_WELL_KNOWN_BINS', () => {
  it('每个条目是 [id, name, bin] 三元素元组', () => {
    expect(EXTRA_WELL_KNOWN_BINS.length).toBeGreaterThan(0)
    for (const e of EXTRA_WELL_KNOWN_BINS) {
      expect(e.length).toBe(3)
      // 三个元素均为非空字符串
      for (const s of e) {
        expect(typeof s).toBe('string')
        expect(s.length).toBeGreaterThan(0)
      }
    }
  })

  it('包含 20 个条目（与 CodePilot 源保持一致）', () => {
    expect(EXTRA_WELL_KNOWN_BINS.length).toBe(20)
  })
})
