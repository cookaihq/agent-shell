/**
 * CLI 工具安装/更新单元测试（TDD）。
 * 全部 deps 通过 vi.fn() 注入，不触及真实系统、不依赖 store.ts。
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { CustomCliTool } from '@agent-shell/contracts'
import {
  extractInstallMethod,
  extractPackageSpec,
  buildUpdateCommand,
  installTool,
  updateTool,
  checkUpdates,
} from '../install'

// ── 共用 mock deps 工厂 ──────────────────────────────────────────────────────

function makeDeps(overrides: Record<string, unknown> = {}) {
  return {
    platform: 'darwin' as NodeJS.Platform,
    runCommand: vi.fn().mockResolvedValue({ code: 0, stdout: '', stderr: '' }),
    detectBinary: vi.fn().mockReturnValue(null),
    probeVersion: vi.fn().mockResolvedValue(null),
    invalidateDetectCache: vi.fn(),
    upsertCustomTool: vi.fn(),
    listCustomTools: vi.fn().mockReturnValue([]),
    ...overrides,
  }
}

// ── extractInstallMethod ─────────────────────────────────────────────────────

describe('extractInstallMethod', () => {
  it('brew install → brew', () => {
    expect(extractInstallMethod('brew install jq')).toBe('brew')
  })
  it('npm install -g → npm', () => {
    expect(extractInstallMethod('npm install -g @e/cli')).toBe('npm')
  })
  it('pipx install → pipx', () => {
    expect(extractInstallMethod('pipx install yt-dlp')).toBe('pipx')
  })
  it('pip install → pip', () => {
    expect(extractInstallMethod('pip install yt-dlp')).toBe('pip')
  })
  it('pip3 install → pip', () => {
    expect(extractInstallMethod('pip3 install yt-dlp')).toBe('pip')
  })
  it('cargo install → cargo', () => {
    expect(extractInstallMethod('cargo install ripgrep')).toBe('cargo')
  })
  it('apt install → apt', () => {
    expect(extractInstallMethod('apt install jq')).toBe('apt')
  })
  it('apt-get install → apt', () => {
    expect(extractInstallMethod('apt-get install jq')).toBe('apt')
  })
  it('未知命令 → unknown', () => {
    expect(extractInstallMethod('winget install jq')).toBe('unknown')
  })
})

// ── extractPackageSpec ───────────────────────────────────────────────────────

describe('extractPackageSpec', () => {
  it('npm install -g @e/cli → @e/cli（保留 scope，无版本钉死）', () => {
    expect(extractPackageSpec('npm install -g @e/cli')).toBe('@e/cli')
  })
  it('brew install stripe/stripe-cli/stripe → stripe/stripe-cli/stripe（tap 路径整体保留）', () => {
    // tap 路径 stripe/stripe-cli/stripe 是第一个 非 - 参数，@版本钉死剥除
    expect(extractPackageSpec('brew install stripe/stripe-cli/stripe')).toBe('stripe/stripe-cli/stripe')
  })
  it('pip install yt-dlp@1.2 → yt-dlp（剥除 @版本）', () => {
    expect(extractPackageSpec('pip install yt-dlp@1.2')).toBe('yt-dlp')
  })
  it('无 install 关键字 → null', () => {
    expect(extractPackageSpec('brew upgrade jq')).toBeNull()
  })
  it('brew install jq → jq', () => {
    expect(extractPackageSpec('brew install jq')).toBe('jq')
  })
})

// ── buildUpdateCommand ───────────────────────────────────────────────────────

describe('buildUpdateCommand', () => {
  it('brew → brew upgrade x', () => {
    expect(buildUpdateCommand('brew', 'x')).toBe('brew upgrade x')
  })
  it('npm → npm update -g x', () => {
    expect(buildUpdateCommand('npm', 'x')).toBe('npm update -g x')
  })
  it('pipx → pipx upgrade x', () => {
    expect(buildUpdateCommand('pipx', 'x')).toBe('pipx upgrade x')
  })
  it('pip → pip install --upgrade x', () => {
    expect(buildUpdateCommand('pip', 'x')).toBe('pip install --upgrade x')
  })
  it('cargo → cargo install x', () => {
    expect(buildUpdateCommand('cargo', 'x')).toBe('cargo install x')
  })
  it('apt → sudo apt-get install --only-upgrade x', () => {
    expect(buildUpdateCommand('apt', 'x')).toBe('sudo apt-get install --only-upgrade x')
  })
  it('unknown → null', () => {
    expect(buildUpdateCommand('unknown', 'x')).toBeNull()
  })
})

// ── installTool ──────────────────────────────────────────────────────────────

describe('installTool', () => {
  it('成功安装 jq（darwin）：返回 ok=true，upsertCustomTool 被调且字段正确', async () => {
    const deps = makeDeps({
      platform: 'darwin',
      runCommand: vi.fn().mockResolvedValue({ code: 0, stdout: 'ok', stderr: '' }),
      detectBinary: vi.fn().mockReturnValue('/opt/homebrew/bin/jq'),
      probeVersion: vi.fn().mockResolvedValue('1.7.1'),
    })

    const result = await installTool('jq', {}, deps)

    expect(result.ok).toBe(true)
    expect(result.version).toBe('1.7.1')
    expect(deps.upsertCustomTool).toHaveBeenCalledTimes(1)
    const arg = (deps.upsertCustomTool as ReturnType<typeof vi.fn>).mock.calls[0][0] as CustomCliTool
    expect(arg.installMethod).toBe('brew')
    expect(arg.installPackage).toBe('jq')
    expect(arg.binPath).toBe('/opt/homebrew/bin/jq')
    expect(arg.version).toBe('1.7.1')
    expect(deps.invalidateDetectCache).toHaveBeenCalledTimes(1)
  })

  it('未知工具 id → {ok:false}，不调 runCommand', async () => {
    const deps = makeDeps()
    const result = await installTool('nonexistent-tool-xyz', {}, deps)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('未知工具')
    expect(deps.runCommand).not.toHaveBeenCalled()
  })

  it('win32 平台装 jq（仅有 darwin/linux 方式）→ {ok:false}，runCommand 未被调用', async () => {
    const deps = makeDeps({ platform: 'win32' as NodeJS.Platform })
    const result = await installTool('jq', {}, deps)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('无安装方式')
    // 关键：安装命令一次都不执行
    expect((deps.runCommand as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0)
  })

  it('exit code !== 0 → {ok:false}，output 含 stderr，upsertCustomTool 未被调', async () => {
    const deps = makeDeps({
      platform: 'darwin',
      runCommand: vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'boom' }),
    })
    const result = await installTool('jq', {}, deps)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('boom')
    expect(deps.upsertCustomTool).not.toHaveBeenCalled()
  })

  it('指定 method 参数时按指定方式安装', async () => {
    // ripgrep 有 brew 和 cargo 两种方式，指定 cargo
    const deps = makeDeps({
      platform: 'darwin',
      runCommand: vi.fn().mockResolvedValue({ code: 0, stdout: 'installed', stderr: '' }),
      detectBinary: vi.fn().mockReturnValue('/usr/local/bin/rg'),
      probeVersion: vi.fn().mockResolvedValue('14.1.0'),
    })
    const result = await installTool('ripgrep', { method: 'cargo' }, deps)
    expect(result.ok).toBe(true)
    // 确认执行的是 cargo install，不是 brew install
    const cmd = (deps.runCommand as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(cmd).toContain('cargo')
    expect(cmd).not.toContain('brew')
  })
})

// ── updateTool ───────────────────────────────────────────────────────────────

describe('updateTool', () => {
  it('从账本找到 jq（brew），执行 brew upgrade jq', async () => {
    const customTools: CustomCliTool[] = [
      {
        id: 'jq', name: 'jq', binName: 'jq', binPath: '/opt/homebrew/bin/jq',
        version: '1.7.0', installMethod: 'brew', installPackage: 'jq', createdAt: Date.now(),
      },
    ]
    const deps = makeDeps({
      listCustomTools: vi.fn().mockReturnValue(customTools),
      runCommand: vi.fn().mockResolvedValue({ code: 0, stdout: 'upgraded', stderr: '' }),
      detectBinary: vi.fn().mockReturnValue('/opt/homebrew/bin/jq'),
      probeVersion: vi.fn().mockResolvedValue('1.7.1'),
    })

    const result = await updateTool('jq', deps)
    expect(result.ok).toBe(true)
    const cmd = (deps.runCommand as ReturnType<typeof vi.fn>).mock.calls[0][0] as string
    expect(cmd).toBe('brew upgrade jq')
    // 刷新账本 + 缓存
    expect(deps.upsertCustomTool).toHaveBeenCalled()
    expect(deps.invalidateDetectCache).toHaveBeenCalled()
  })

  it('账本无记录、catalog 也无 → {ok:false}，runCommand 未调', async () => {
    const deps = makeDeps({
      listCustomTools: vi.fn().mockReturnValue([]),
    })
    const result = await updateTool('nonexistent-xyz', deps)
    expect(result.ok).toBe(false)
    expect(deps.runCommand).not.toHaveBeenCalled()
  })

  it('账本有记录但 installMethod 无法推导更新命令（unknown）→ {ok:false}', async () => {
    const customTools: CustomCliTool[] = [
      {
        id: 'custom-foo', name: 'Foo', binName: 'foo', binPath: '/usr/local/bin/foo',
        version: '1.0.0', installMethod: 'unknown', installPackage: undefined, createdAt: Date.now(),
      },
    ]
    const deps = makeDeps({ listCustomTools: vi.fn().mockReturnValue(customTools) })
    const result = await updateTool('custom-foo', deps)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('无法推导')
    expect(deps.runCommand).not.toHaveBeenCalled()
  })

  it('exit code !== 0 → {ok:false}，output 含错误信息', async () => {
    const customTools: CustomCliTool[] = [
      {
        id: 'jq', name: 'jq', binName: 'jq', binPath: '/opt/homebrew/bin/jq',
        version: '1.7.0', installMethod: 'brew', installPackage: 'jq', createdAt: Date.now(),
      },
    ]
    const deps = makeDeps({
      listCustomTools: vi.fn().mockReturnValue(customTools),
      runCommand: vi.fn().mockResolvedValue({ code: 1, stdout: '', stderr: 'update failed' }),
    })
    const result = await updateTool('jq', deps)
    expect(result.ok).toBe(false)
    expect(result.output).toContain('update failed')
    expect(deps.upsertCustomTool).not.toHaveBeenCalled()
  })
})

// ── checkUpdates ─────────────────────────────────────────────────────────────

describe('checkUpdates', () => {
  it('brew outdated 有结果时返回匹配 catalog 的更新项', async () => {
    // brew outdated --json 真实返回 {formulae:[...],casks:[...]}（实测 Homebrew 5.1.15），非扁平数组
    const brewOutdated = JSON.stringify({
      formulae: [{ name: 'jq', installed_versions: ['1.6'], current_version: '1.7.1' }],
      casks: [],
    })
    const deps = makeDeps({
      runCommand: vi.fn().mockImplementation((cmd: string) => {
        if (cmd.includes('brew outdated')) return Promise.resolve({ code: 0, stdout: brewOutdated, stderr: '' })
        if (cmd.includes('npm outdated')) return Promise.resolve({ code: 0, stdout: '{}', stderr: '' })
        return Promise.resolve({ code: 0, stdout: '', stderr: '' })
      }),
      listCustomTools: vi.fn().mockReturnValue([]),
    })

    const updates = await checkUpdates(deps)
    expect(updates.length).toBeGreaterThanOrEqual(1)
    const jqUpdate = updates.find((u) => u.id === 'jq')
    expect(jqUpdate).toBeDefined()
    expect(jqUpdate?.current).toBe('1.6')
    expect(jqUpdate?.latest).toBe('1.7.1')
    expect(jqUpdate?.method).toBe('brew')
  })

  it('brew/npm 均无更新，installMethod=unknown 的 custom 工具版本变化时报告', async () => {
    // 对齐 CodePilot line 690：仅对 unknown/brew/npm 的 custom 工具重测版本
    const customTools: CustomCliTool[] = [
      {
        id: 'custom-bar', name: 'Bar', binName: 'bar', binPath: '/usr/local/bin/bar',
        version: '1.0.0', installMethod: 'unknown', installPackage: 'bar', createdAt: Date.now(),
      },
    ]
    const deps = makeDeps({
      runCommand: vi.fn().mockImplementation((cmd: string) => {
        if (cmd.includes('brew outdated')) return Promise.resolve({ code: 0, stdout: '{"formulae":[],"casks":[]}', stderr: '' })
        if (cmd.includes('npm outdated')) return Promise.resolve({ code: 0, stdout: '{}', stderr: '' })
        return Promise.resolve({ code: 0, stdout: '', stderr: '' })
      }),
      listCustomTools: vi.fn().mockReturnValue(customTools),
      probeVersion: vi.fn().mockResolvedValue('2.0.0'),
    })

    const updates = await checkUpdates(deps)
    const barUpdate = updates.find((u) => u.id === 'custom-bar')
    expect(barUpdate).toBeDefined()
    expect(barUpdate?.current).toBe('1.0.0')
    expect(barUpdate?.latest).toBe('2.0.0')
  })

  it('installMethod=pipx 的 custom 工具即使版本变化也不被报告（CodePilot 有意 continue 跳过）', async () => {
    // CodePilot line 690：pipx/pip/cargo/apt 的"版本漂移"≠"有新版可用"，一律跳过
    const customTools: CustomCliTool[] = [
      {
        id: 'custom-baz', name: 'Baz', binName: 'baz', binPath: '/usr/local/bin/baz',
        version: '1.0.0', installMethod: 'pipx', installPackage: 'baz', createdAt: Date.now(),
      },
    ]
    const deps = makeDeps({
      runCommand: vi.fn().mockImplementation((cmd: string) => {
        if (cmd.includes('brew outdated')) return Promise.resolve({ code: 0, stdout: '{"formulae":[],"casks":[]}', stderr: '' })
        if (cmd.includes('npm outdated')) return Promise.resolve({ code: 0, stdout: '{}', stderr: '' })
        return Promise.resolve({ code: 0, stdout: '', stderr: '' })
      }),
      listCustomTools: vi.fn().mockReturnValue(customTools),
      probeVersion: vi.fn().mockResolvedValue('2.0.0'),  // 版本确实漂移了
    })

    const updates = await checkUpdates(deps)
    // pipx 工具被 continue 跳过，不在 updates 里
    expect(updates.find((u) => u.id === 'custom-baz')).toBeUndefined()
    // probeVersion 不应对 pipx 工具被调用（continue 在 probe 之前）
    expect(deps.probeVersion).not.toHaveBeenCalled()
  })

  it('brew/npm 命令失败时吞掉错误，返回空数组', async () => {
    const deps = makeDeps({
      runCommand: vi.fn().mockRejectedValue(new Error('command not found')),
      listCustomTools: vi.fn().mockReturnValue([]),
    })
    const updates = await checkUpdates(deps)
    expect(Array.isArray(updates)).toBe(true)
    // 不抛异常
  })
})
