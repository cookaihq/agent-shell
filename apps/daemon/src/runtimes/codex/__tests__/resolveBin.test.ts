import { describe, it, expect } from 'vitest'
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { resolveCodexBinary, targetTripleFor, platformPackageFor, type ResolveCodexDeps } from '../resolveBin'

/** 在内存里假造一套 @openai/codex + 平台子包的 vendor 布局（current platform），返回 deps + 期望路径。 */
function fakeLayout(opts?: { platform?: NodeJS.Platform; arch?: string }) {
  const platform = opts?.platform ?? process.platform
  const arch = opts?.arch ?? process.arch
  const triple = targetTripleFor(platform, arch as NodeJS.Architecture)!
  const platPkg = platformPackageFor(triple)!
  const binName = platform === 'win32' ? 'codex.exe' : 'codex'

  // 伪造目录：/fake/codex/{package.json,bin/codex.js}；平台包 /fake/codex-plat/.../package.json + vendor
  const codexPkgJson = `/fake/cm/@openai/codex/package.json`
  const platPkgJson = `/fake/cm/${platPkg}/package.json`
  const platDir = path.dirname(platPkgJson)
  const binPath = path.join(platDir, 'vendor', triple, 'bin', binName)
  const pathDir = path.join(platDir, 'vendor', triple, 'codex-path')

  const existing = new Set<string>([codexPkgJson, binPath, pathDir])
  const resolveMap: Record<string, string> = {
    '@openai/codex/package.json': codexPkgJson,
    [`${platPkg}/package.json`]: platPkgJson,
  }
  const deps: ResolveCodexDeps = {
    platform,
    arch: arch as NodeJS.Architecture,
    resolveFrom: (_anchor, request) => {
      const r = resolveMap[request]
      if (!r) throw new Error(`Cannot find module '${request}'`)
      return r
    },
    fileExists: (p) => existing.has(p),
  }
  return { deps, binPath, pathDir, codexPkgJson }
}

describe('targetTriple / platformPackage 映射（对齐官方 shim）', () => {
  it('darwin-arm64 → aarch64-apple-darwin / @openai/codex-darwin-arm64', () => {
    expect(targetTripleFor('darwin', 'arm64')).toBe('aarch64-apple-darwin')
    expect(platformPackageFor('aarch64-apple-darwin')).toBe('@openai/codex-darwin-arm64')
  })
  it('linux-x64 → x86_64-unknown-linux-musl / @openai/codex-linux-x64', () => {
    expect(targetTripleFor('linux', 'x64')).toBe('x86_64-unknown-linux-musl')
    expect(platformPackageFor('x86_64-unknown-linux-musl')).toBe('@openai/codex-linux-x64')
  })
  it('win32-x64 → x86_64-pc-windows-msvc / @openai/codex-win32-x64', () => {
    expect(targetTripleFor('win32', 'x64')).toBe('x86_64-pc-windows-msvc')
    expect(platformPackageFor('x86_64-pc-windows-msvc')).toBe('@openai/codex-win32-x64')
  })
})

describe('resolveCodexBinary（注入假布局：覆盖 packaged 分支语义）', () => {
  it('沿 @openai/codex 锚点解析出平台包 vendor/<triple>/bin/codex + codex-path', () => {
    const { deps, binPath, pathDir } = fakeLayout()
    const r = resolveCodexBinary(deps)
    expect(r.binPath).toBe(binPath)
    expect(r.pathDir).toBe(pathDir)
  })

  it('codex bin 缺失 → 抛清晰错误（无系统版兜底，D3 仅自带版）', () => {
    const { deps, binPath } = fakeLayout()
    const broken: ResolveCodexDeps = { ...deps, fileExists: (p) => p !== binPath && deps.fileExists(p) }
    expect(() => resolveCodexBinary(broken)).toThrow(/codex/i)
  })

  it('@openai/codex 整个解析不到 → 抛清晰错误', () => {
    const deps: ResolveCodexDeps = {
      platform: process.platform,
      arch: process.arch,
      resolveFrom: () => { throw new Error('Cannot find module') },
      fileExists: () => false,
    }
    expect(() => resolveCodexBinary(deps)).toThrow(/codex/i)
  })
})

describe('resolveCodexBinary（真实 dev：已 pnpm install 的自带版）', () => {
  it('返回真实存在、可执行的 codex 二进制 + 含 rg 的 codex-path', () => {
    const r = resolveCodexBinary()
    expect(fs.existsSync(r.binPath)).toBe(true)
    expect(fs.existsSync(r.pathDir)).toBe(true)
    const rg = path.join(r.pathDir, process.platform === 'win32' ? 'rg.exe' : 'rg')
    expect(fs.existsSync(rg)).toBe(true)
  })

  it('自带版二进制能跑起来（--version 报 0.137.x）——证明 vendor 二进制+解析无需系统 codex', () => {
    const r = resolveCodexBinary()
    const out = execFileSync(r.binPath, ['--version'], { encoding: 'utf8', timeout: 10000 })
    expect(out).toMatch(/0\.137\./)
  })
})
