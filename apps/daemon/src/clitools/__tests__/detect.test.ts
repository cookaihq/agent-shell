/**
 * CLI 工具检测单元测试（TDD）。
 * 使用依赖注入 deps 参数，不依赖真实 PATH / 系统工具。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { CliToolDef } from '@agent-shell/contracts'
import {
  detectCliTool,
  detectAllCliTools,
  parseCliVersion,
  invalidateDetectCache,
} from '../detect'

// ── beforeEach：清缓存，防测试间串扰 ────────────────────────────────────────
beforeEach(() => {
  invalidateDetectCache()
})

// ── parseCliVersion 纯函数 ───────────────────────────────────────────────────
describe('parseCliVersion', () => {
  it('正则分支：匹配 jq-1.7.1 格式', () => {
    expect(parseCliVersion('jq-1.7.1')).toBe('1.7.1')
  })

  it('正则分支：匹配普通版本字符串（含 -static 后缀视为合法版本）', () => {
    // 正则 \d+\.\d+[\w.-]* 会捕获 "6.1.2-static" 整体，这是合法版本字符串
    expect(parseCliVersion('ffmpeg version 6.1.2-static')).toBe('6.1.2-static')
  })

  it('JSON 内含 semver 时正则优先命中（不走 JSON.parse，直接从字符串抓 2.0.0）', () => {
    // 正则 \d+\.\d+ 先命中 JSON 文本里的 "2.0.0"，根本走不到 JSON.parse 分支
    expect(parseCliVersion('{"version":"2.0.0"}')).toBe('2.0.0')
  })

  it('JSON.version 分支：正则匹配不到（version 非 semver 形态）才真正走 JSON.parse().version', () => {
    // "nightly" 不含 数字.数字，正则落空 → 进入 JSON.parse 读 .version
    expect(parseCliVersion('{"version":"nightly"}')).toBe('nightly')
  })

  it('JSON 格式但无 version 字段→ null，退回正则无命中→ null', () => {
    expect(parseCliVersion('{"name":"foo"}')).toBe(null)
  })

  it('无版本信息→ null', () => {
    expect(parseCliVersion('no version text')).toBe(null)
  })

  it('合并 stdout+stderr 后从 stderr 解析版本', () => {
    // ffmpeg 把版本写到 stderr
    expect(parseCliVersion('\nffmpeg version 4.4.1')).toBe('4.4.1')
  })
})

// ── detectCliTool ────────────────────────────────────────────────────────────
describe('detectCliTool', () => {
  it('binName 命中→ status installed，version 从 stdout 解析', async () => {
    const fakePath = '/usr/local/bin/jq'
    const fakeDetectBinary = vi.fn((name: string) => (name === 'jq' ? fakePath : null))
    const fakeExecFile = vi.fn(async () => ({ stdout: 'jq-1.7.1', stderr: '' }))

    const def = CliToolDef.parse({ id: 'jq', name: 'jq', binNames: ['jq'] })
    const result = await detectCliTool(def, {
      detectBinary: fakeDetectBinary,
      execFile: fakeExecFile,
    })

    expect(result.id).toBe('jq')
    expect(result.status).toBe('installed')
    expect(result.version).toBe('1.7.1')
    expect(result.binPath).toBe(fakePath)
  })

  it('detectBinary 全返回 null → status not_installed', async () => {
    const def = CliToolDef.parse({ id: 'jq', name: 'jq', binNames: ['jq'] })
    const result = await detectCliTool(def, {
      detectBinary: vi.fn(() => null),
      execFile: vi.fn(),
    })

    expect(result.status).toBe('not_installed')
    expect(result.version).toBe(null)
    expect(result.binPath).toBe(null)
  })

  it('版本解析走 JSON.parse().version（version 非 semver，正则落空）', async () => {
    const fakePath = '/usr/local/bin/myTool'
    const def = CliToolDef.parse({ id: 'mytool', name: 'myTool', binNames: ['myTool'] })
    const result = await detectCliTool(def, {
      detectBinary: vi.fn(() => fakePath),
      // "nightly" 不含 数字.数字 → 正则落空 → 真正走 JSON.parse 读 .version
      execFile: vi.fn(async () => ({ stdout: '{"version":"nightly"}', stderr: '' })),
    })

    expect(result.status).toBe('installed')
    expect(result.version).toBe('nightly')
  })

  it('返回 "no version text" → version null，但 status 仍 installed（可执行存在）', async () => {
    const fakePath = '/usr/local/bin/weirdTool'
    const def = CliToolDef.parse({ id: 'weirdtool', name: 'weirdTool', binNames: ['weirdTool'] })
    const result = await detectCliTool(def, {
      detectBinary: vi.fn(() => fakePath),
      execFile: vi.fn(async () => ({ stdout: 'no version text', stderr: '' })),
    })

    expect(result.status).toBe('installed')
    expect(result.version).toBe(null)
    expect(result.binPath).toBe(fakePath)
  })

  it('binNames 多个时：第一个 null、第二个命中', async () => {
    const fakePath = '/opt/homebrew/bin/ffprobe'
    const fakeDetectBinary = vi.fn((name: string) =>
      name === 'ffprobe' ? fakePath : null,
    )
    const def = CliToolDef.parse({
      id: 'ffmpeg',
      name: 'FFmpeg',
      binNames: ['ffmpeg', 'ffprobe'],
    })
    const result = await detectCliTool(def, {
      detectBinary: fakeDetectBinary,
      execFile: vi.fn(async () => ({ stdout: 'ffprobe version 6.1', stderr: '' })),
    })

    expect(result.status).toBe('installed')
    expect(result.binPath).toBe(fakePath)
    expect(result.version).toBe('6.1')
  })

  it('execFile 抛出错误时从 err.stdout/stderr 兜底解析版本', async () => {
    const fakePath = '/usr/local/bin/sometool'
    const def = CliToolDef.parse({ id: 'sometool', name: 'some', binNames: ['sometool'] })
    const err = Object.assign(new Error('exit 1'), { stdout: '1.2.3\n', stderr: '' })
    const result = await detectCliTool(def, {
      detectBinary: vi.fn(() => fakePath),
      execFile: vi.fn(async () => { throw err }),
    })

    expect(result.status).toBe('installed')
    expect(result.version).toBe('1.2.3')
    expect(result.binPath).toBe(fakePath)
  })
})

// ── detectAllCliTools + 缓存 ─────────────────────────────────────────────────
describe('detectAllCliTools + cache', () => {
  it('返回 catalog(12) + EXTRA(20) + custom 的条目数', async () => {
    const customTools = [
      { id: 'mycustom', name: 'MyCustom', binName: '/custom/bin', binPath: '/custom/bin', createdAt: Date.now(), version: null },
    ]
    const result = await detectAllCliTools({
      detectBinary: vi.fn(() => null),
      execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
      customTools,
    })

    // 12 catalog + 20 extra + 1 custom = 33
    expect(result.length).toBe(33)

    const ids = result.map((r) => r.id)
    // 断言 EXTRA 工具确实以正确 id 进入结果——防 EXTRA 元组 [id,name,bin] 解构顺序写反时
    // 仅靠数量断言抓不到（数量不变但 id 会变成 name/bin）
    expect(ids).toContain('wget')
    // 同时断言 catalog 工具 id 在内，确认三段都拼对
    expect(ids).toContain('ffmpeg')
  })

  it('缓存：120s 内第二次调用不再执行 detectBinary', async () => {
    const fakeDetectBinary = vi.fn(() => null)

    await detectAllCliTools({ detectBinary: fakeDetectBinary, execFile: vi.fn(async () => ({ stdout: '', stderr: '' })) })
    const firstCallCount = fakeDetectBinary.mock.calls.length

    // 第二次调用（缓存未过期）
    await detectAllCliTools({ detectBinary: fakeDetectBinary, execFile: vi.fn(async () => ({ stdout: '', stderr: '' })) })
    const secondCallCount = fakeDetectBinary.mock.calls.length

    // 第二次不应增加调用
    expect(secondCallCount).toBe(firstCallCount)
  })

  it('invalidateDetectCache 后，再次调用会重新执行 detectBinary', async () => {
    const fakeDetectBinary = vi.fn(() => null)

    await detectAllCliTools({ detectBinary: fakeDetectBinary, execFile: vi.fn(async () => ({ stdout: '', stderr: '' })) })
    const afterFirstCall = fakeDetectBinary.mock.calls.length

    invalidateDetectCache()

    // 清缓存后第三次调用
    await detectAllCliTools({ detectBinary: fakeDetectBinary, execFile: vi.fn(async () => ({ stdout: '', stderr: '' })) })
    const afterThirdCall = fakeDetectBinary.mock.calls.length

    expect(afterThirdCall).toBeGreaterThan(afterFirstCall)
  })

  it('custom 工具出现在结果中，id 正确', async () => {
    const customTools = [
      { id: 'my-special-tool', name: 'My Special Tool', binName: 'mySpecial', binPath: '/path/to/mySpecial', createdAt: Date.now(), version: null },
    ]
    const result = await detectAllCliTools({
      detectBinary: vi.fn(() => null),
      execFile: vi.fn(async () => ({ stdout: '', stderr: '' })),
      customTools,
    })

    const ids = result.map((r) => r.id)
    expect(ids).toContain('my-special-tool')
  })
})

// ── 缓存 TTL 自然过期（独立 describe，自管 fake timers 防污染其他用例）─────────
describe('detectAllCliTools cache TTL natural expiry', () => {
  // 用假时钟让 Date.now() 可控推进——detectAllCliTools 靠 Date.now() 判缓存是否过期
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('TTL（120s）自然到期后再次调用会重新执行 detectBinary', async () => {
    const fakeDetectBinary = vi.fn(() => null)
    const deps = { detectBinary: fakeDetectBinary, execFile: vi.fn(async () => ({ stdout: '', stderr: '' })) }

    // 首次：冷扫描，detectBinary 被调
    await detectAllCliTools(deps)
    const afterFirst = fakeDetectBinary.mock.calls.length
    expect(afterFirst).toBeGreaterThan(0)

    // 推进 120_001ms 让缓存自然过期（Date.now() 随假时钟前进）
    vi.advanceTimersByTime(120_001)

    // 过期后再调：应重新冷扫描，detectBinary 调用次数增加
    await detectAllCliTools(deps)
    const afterExpiry = fakeDetectBinary.mock.calls.length
    expect(afterExpiry).toBeGreaterThan(afterFirst)
  })
})
