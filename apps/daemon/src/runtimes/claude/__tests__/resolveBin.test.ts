import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveClaudeBinary, platformPackageCandidates, type ResolveClaudeDeps } from '../resolveBin'

/** 在内存里假造一套 @anthropic-ai/claude-agent-sdk + 平台子包布局（current platform），返回 deps + 期望路径。 */
function fakeLayout(opts?: { platform?: NodeJS.Platform; arch?: NodeJS.Architecture }) {
  const platform = opts?.platform ?? process.platform
  const arch = opts?.arch ?? process.arch
  const pkg = platformPackageCandidates(platform, arch)[0]
  const binName = platform === 'win32' ? 'claude.exe' : 'claude'

  const sdkMain = `/fake/cm/@anthropic-ai/claude-agent-sdk/sdk.mjs`
  const platPkgJson = `/fake/cm/${pkg}/package.json`
  const binPath = path.join(path.dirname(platPkgJson), binName)

  const existing = new Set<string>([binPath])
  const resolveMap: Record<string, string> = {
    '@anthropic-ai/claude-agent-sdk': sdkMain,
    [`${pkg}/package.json`]: platPkgJson,
  }
  const deps: ResolveClaudeDeps = {
    platform,
    arch,
    resolveFrom: (_anchor, request) => {
      const r = resolveMap[request]
      if (!r) throw new Error(`Cannot find module '${request}'`)
      return r
    },
    fileExists: (p) => existing.has(p),
  }
  return { deps, binPath, sdkMain }
}

describe('platformPackageCandidates（平台子包候选名，对齐 SDK optionalDependencies）', () => {
  it('darwin-arm64 → @anthropic-ai/claude-agent-sdk-darwin-arm64（单候选）', () => {
    expect(platformPackageCandidates('darwin', 'arm64')).toEqual(['@anthropic-ai/claude-agent-sdk-darwin-arm64'])
  })
  it('win32-x64 → @anthropic-ai/claude-agent-sdk-win32-x64（单候选）', () => {
    expect(platformPackageCandidates('win32', 'x64')).toEqual(['@anthropic-ai/claude-agent-sdk-win32-x64'])
  })
  it('linux-x64 → glibc + musl 两候选（按 libc 装哪个用哪个）', () => {
    expect(platformPackageCandidates('linux', 'x64')).toEqual([
      '@anthropic-ai/claude-agent-sdk-linux-x64',
      '@anthropic-ai/claude-agent-sdk-linux-x64-musl',
    ])
  })
})

describe('resolveClaudeBinary（注入假布局：覆盖解析链）', () => {
  it('沿 SDK 主入口锚点解析出平台子包目录下的 claude', () => {
    const { deps, binPath } = fakeLayout()
    expect(resolveClaudeBinary(deps)).toBe(binPath)
  })

  it('claude 二进制缺失 → 抛清晰错误（无系统版兜底）', () => {
    const { deps, binPath } = fakeLayout()
    const broken: ResolveClaudeDeps = { ...deps, fileExists: (p) => p !== binPath && deps.fileExists(p) }
    expect(() => resolveClaudeBinary(broken)).toThrow(/claude/i)
  })

  it('@anthropic-ai/claude-agent-sdk 整个解析不到 → 抛清晰错误', () => {
    const deps: ResolveClaudeDeps = {
      platform: process.platform,
      arch: process.arch,
      resolveFrom: () => { throw new Error('Cannot find module') },
      fileExists: () => false,
    }
    expect(() => resolveClaudeBinary(deps)).toThrow(/claude/i)
  })

  it('linux：第一候选（glibc）未装 → 回落第二候选（musl）', () => {
    const platform: NodeJS.Platform = 'linux'
    const arch: NodeJS.Architecture = 'x64'
    const [glibcPkg, muslPkg] = platformPackageCandidates(platform, arch)
    const sdkMain = '/fake/cm/@anthropic-ai/claude-agent-sdk/sdk.mjs'
    const muslPkgJson = `/fake/cm/${muslPkg}/package.json`
    const muslBin = path.join(path.dirname(muslPkgJson), 'claude')
    const deps: ResolveClaudeDeps = {
      platform, arch,
      resolveFrom: (_anchor, request) => {
        if (request === '@anthropic-ai/claude-agent-sdk') return sdkMain
        if (request === `${glibcPkg}/package.json`) throw new Error('not installed (glibc)')
        if (request === `${muslPkg}/package.json`) return muslPkgJson
        throw new Error(`Cannot find module '${request}'`)
      },
      fileExists: (p) => p === muslBin,
    }
    expect(resolveClaudeBinary(deps)).toBe(muslBin)
  })
})

describe('resolveClaudeBinary（真实 dev：已 pnpm install 的自带版）', () => {
  it('返回真实存在的 claude 二进制', () => {
    const bin = resolveClaudeBinary()
    expect(fs.existsSync(bin)).toBe(true)
  })

  it('自带版二进制能跑 --version（报 2.1.x）——证明无需系统 claude', () => {
    const bin = resolveClaudeBinary()
    const out = execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 10000 })
    expect(out).toMatch(/\b2\.1\.\d+/)
  })
})
