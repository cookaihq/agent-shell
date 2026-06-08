import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { detectBinary, detectEngines, executableCandidates, type DetectionDeps } from '../detection'

// 构造一个用内存"文件系统"的 deps：existing 是可执行文件全路径集合。
// runnable（缺省=全部 existing）才被 probeVersion 视为"能跑出版本"，用于测「挑能跑的」逻辑。
function deps(opts: {
  pathDirs?: string[]; existing?: string[]; home?: string; nvmNodes?: string[]; runnable?: string[]; platform?: NodeJS.Platform
  bundledCodex?: string | null; bundledClaude?: string | null
}): DetectionDeps {
  const existing = new Set(opts.existing ?? [])
  const runnable = new Set(opts.runnable ?? opts.existing ?? [])
  const nvmNodes = opts.nvmNodes ?? []
  return {
    env: { PATH: (opts.pathDirs ?? []).join(':') },
    home: opts.home ?? '/Users/me',
    platform: opts.platform ?? 'linux',
    fileExists: (p) => existing.has(p),
    listDir: (p) => (p.endsWith('/.nvm/versions/node') ? nvmNodes : []),
    probeVersion: (p) => (runnable.has(p) ? '1.0.0' : null),
    // 自带版 claude/codex：detectEngines 据此报随包二进制路径（不扫系统）；缺省=未解析到。
    resolveBundledCodex: () => (opts.bundledCodex ?? null),
    resolveBundledClaude: () => (opts.bundledClaude ?? null),
  }
}

describe('detectBinary 兜底链', () => {
  it('优先命中 PATH 中的二进制', () => {
    const d = deps({ pathDirs: ['/usr/bin', '/opt/homebrew/bin'], existing: ['/usr/bin/claude', '/opt/homebrew/bin/claude'] })
    expect(detectBinary('claude', d)).toBe('/usr/bin/claude')
  })

  it('PATH 没有时回落到 Homebrew', () => {
    const d = deps({ pathDirs: ['/usr/bin'], existing: ['/opt/homebrew/bin/codex'] })
    expect(detectBinary('codex', d)).toBe('/opt/homebrew/bin/codex')
  })

  it('回落到 NVM 版本化 bin 目录', () => {
    const d = deps({ pathDirs: [], home: '/Users/me', nvmNodes: ['v20.0.0'], existing: ['/Users/me/.nvm/versions/node/v20.0.0/bin/claude'] })
    expect(detectBinary('claude', d)).toBe('/Users/me/.nvm/versions/node/v20.0.0/bin/claude')
  })

  it('哪都没有时返回 null', () => {
    expect(detectBinary('claude', deps({ pathDirs: ['/usr/bin'], existing: [] }))).toBeNull()
  })

  it('NVM 优先于 Homebrew', () => {
    const d = deps({
      pathDirs: [],
      home: '/Users/me',
      nvmNodes: ['v20.0.0'],
      existing: ['/Users/me/.nvm/versions/node/v20.0.0/bin/claude', '/opt/homebrew/bin/claude'],
    })
    expect(detectBinary('claude', d)).toBe('/Users/me/.nvm/versions/node/v20.0.0/bin/claude')
  })
})

describe('detectBinary 在多安装间挑「真能跑出版本」的那个', () => {
  it('跳过存在但跑不起来的（如需 node 的 JS 脚本），选后面能跑的原生版', () => {
    // 模拟本机真实情况：v22.17 是 JS 脚本（无 node 跑不动），v24.13 是原生二进制（能跑）
    const d = deps({
      pathDirs: [],
      home: '/Users/me',
      nvmNodes: ['v22.17.0', 'v24.13.0'],
      existing: ['/Users/me/.nvm/versions/node/v22.17.0/bin/claude', '/Users/me/.nvm/versions/node/v24.13.0/bin/claude'],
      runnable: ['/Users/me/.nvm/versions/node/v24.13.0/bin/claude'],
    })
    expect(detectBinary('claude', d)).toBe('/Users/me/.nvm/versions/node/v24.13.0/bin/claude')
  })

  it('nvm 多版本：即使目录枚举是旧版在前，也按版本号降序优先命中最新版', () => {
    // 本机真实坑：v24.12 装了旧 claude 2.1.37、v24.13 装了新 2.1.156，readdir 旧版在前。
    // 按版本号降序排后，最新版目录先被检索，「第一个能跑的就用」即命中 v24.13.0（不必探测旧版）。
    const old = '/Users/me/.nvm/versions/node/v24.12.0/bin/claude'
    const neu = '/Users/me/.nvm/versions/node/v24.13.0/bin/claude'
    const d = deps({
      pathDirs: [],
      home: '/Users/me',
      nvmNodes: ['v24.12.0', 'v24.13.0'], // 旧版目录排在前（模拟 readdirSync）
      existing: [old, neu],
    })
    expect(detectBinary('claude', d)).toBe(neu)
  })

  it('最新版目录里的安装跑不起来时，降序回落到次新版能跑的', () => {
    // v24.13 是坏 shim（跑不出），v24.12 能跑 → 降序先试 v24.13（跳过）再命中 v24.12。
    const broken = '/Users/me/.nvm/versions/node/v24.13.0/bin/claude'
    const ok = '/Users/me/.nvm/versions/node/v24.12.0/bin/claude'
    const d = deps({
      pathDirs: [],
      home: '/Users/me',
      nvmNodes: ['v24.12.0', 'v24.13.0'],
      existing: [broken, ok],
      runnable: [ok],
    })
    expect(detectBinary('claude', d)).toBe(ok)
  })

  it('一个都跑不起来时，退回第一个存在的（按降序后是最新版目录的那个）', () => {
    const d = deps({
      pathDirs: [],
      home: '/Users/me',
      nvmNodes: ['v22.17.0', 'v22.20.0'],
      existing: ['/Users/me/.nvm/versions/node/v22.17.0/bin/codex', '/Users/me/.nvm/versions/node/v22.20.0/bin/codex'],
      runnable: [],
    })
    // 降序后 v22.20.0 在前 → firstExisting = v22.20.0
    expect(detectBinary('codex', d)).toBe('/Users/me/.nvm/versions/node/v22.20.0/bin/codex')
  })
})

describe('detectEngines', () => {
  it('claude/codex 均报自带版随包二进制路径（都不扫系统 PATH）', () => {
    const d = deps({ pathDirs: ['/usr/bin'], existing: ['/usr/bin/claude', '/usr/bin/codex'], bundledClaude: '/bundled/claude', bundledCodex: '/bundled/codex' })
    expect(detectEngines(d)).toEqual({ claude: '/bundled/claude', codex: '/bundled/codex' })
  })
  it('自带版解析不到时报 null（不回落系统版）——即便系统 PATH 里装着 claude/codex', () => {
    const d = deps({ pathDirs: ['/usr/bin'], existing: ['/usr/bin/claude', '/usr/bin/codex'], bundledClaude: null, bundledCodex: null })
    expect(detectEngines(d)).toEqual({ claude: null, codex: null })
  })
})

describe('detectBinary 真实文件系统谓词（仅匹配可执行文件，非目录/非可执行）', () => {
  it('同名目录与非可执行文件被忽略，只命中可执行文件', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'as-detect-'))
    const prevPath = process.env.PATH
    try {
      fs.mkdirSync(path.join(tmp, 'dirbin'))                                    // (a) 同名目录
      fs.writeFileSync(path.join(tmp, 'noexec'), '#!/bin/sh\n', { mode: 0o644 }) // (b) 非可执行
      const exe = path.join(tmp, 'realbin')
      fs.writeFileSync(exe, '#!/bin/sh\n', { mode: 0o755 })                      // (c) 可执行
      process.env.PATH = tmp   // 用真实 realDeps（detectBinary 的默认）只看这个目录
      expect(detectBinary('dirbin')).toBeNull()   // 目录不算二进制
      expect(detectBinary('noexec')).toBeNull()    // 非可执行不算
      expect(detectBinary('realbin')).toBe(exe)    // 可执行命中
    } finally {
      process.env.PATH = prevPath
      fs.rmSync(tmp, { recursive: true, force: true })
    }
  })
})

describe('detectBinary — win32 按 PATHEXT 补扩展名（修 winget/npm 装的 .exe/.cmd 识别）', () => {
  it('裸名 stat 不到、命中同目录的 claude.exe（正是线上「未检测到」的场景）', () => {
    const dir = 'C:\\Users\\me\\AppData\\Local\\Microsoft\\WinGet\\Links'
    const exe = path.win32.join(dir, 'claude.exe')   // winget 实际装的文件；裸 'claude' 不存在。用 win32 拼接，使本测试在任意 host（mac/CI）都成立
    const d: DetectionDeps = {
      env: { PATH: dir, PATHEXT: '.COM;.EXE;.CMD' },
      home: 'C:\\Users\\me',
      platform: 'win32',
      fileExists: (p) => p === exe,
      listDir: () => [],
      probeVersion: (p) => (p === exe ? '2.1.0' : null),
      resolveBundledCodex: () => null,
      resolveBundledClaude: () => null,
    }
    expect(detectBinary('claude', d)).toBe(exe)
  })

  it('同场景在 posix 下只试裸名 → 找不到（佐证补扩展名是 win32 专属修复）', () => {
    const dir = '/usr/local/bin'
    const exe = path.join(dir, 'claude.exe')
    const d: DetectionDeps = {
      env: { PATH: dir },
      home: '/Users/me',
      platform: 'linux',
      fileExists: (p) => p === exe,
      listDir: () => [],
      probeVersion: (p) => (p === exe ? '2.1.0' : null),
      resolveBundledCodex: () => null,
      resolveBundledClaude: () => null,
    }
    expect(detectBinary('claude', d)).toBeNull()
  })
})

describe('executableCandidates', () => {
  it('win32 按 PATHEXT 生成「裸名 + 各扩展名（小写）」', () => {
    expect(executableCandidates('claude', 'win32', '.EXE;.CMD')).toEqual(['claude', 'claude.exe', 'claude.cmd'])
  })
  it('win32 缺 PATHEXT 用默认集', () => {
    expect(executableCandidates('codex', 'win32', undefined)).toEqual(['codex', 'codex.com', 'codex.exe', 'codex.bat', 'codex.cmd'])
  })
  it('posix 只用裸名（忽略 PATHEXT）', () => {
    expect(executableCandidates('claude', 'linux', '.EXE;.CMD')).toEqual(['claude'])
  })
})
