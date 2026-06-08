import { describe, it, expect, vi } from 'vitest'
import {
  installSkillToolHandler,
  createSkillToolHandler,
  buildBuiltinToolsMcp,
  cliListToolHandler,
  cliInstallToolHandler,
  cliAddToolHandler,
  cliRemoveToolHandler,
  cliCheckUpdatesToolHandler,
  cliUpdateToolHandler,
  type CliMcpDeps,
} from '../builtinTools'
import type { InstallSkillReq, InstallSkillResult } from '@agent-shell/contracts'

type InstallSkillFn = (req: InstallSkillReq) => Promise<InstallSkillResult>

// ── 原 installSkillToolHandler 测试（保留）───────────────────────────────────

describe('installSkillToolHandler', () => {
  it('调 installSkill 回调并把结果序列化进 content text', async () => {
    const result: InstallSkillResult = {
      installed: [{ name: 'foo', effectiveName: 'foo', sourceId: 's1' }],
      already: [],
      conflicts: [],
    }
    const installSkill = vi.fn<InstallSkillFn>().mockResolvedValue(result)
    const args: InstallSkillReq = { type: 'folder', loc: '/x' }

    const out = await installSkillToolHandler(installSkill, args)

    expect(installSkill).toHaveBeenCalledWith(args)
    expect(out.content).toHaveLength(1)
    expect(out.content[0].type).toBe('text')
    expect(out.content[0].text).toContain('foo')
    expect(JSON.parse(out.content[0].text)).toEqual(result)
  })

  it('already/conflicts 时也正常序列化', async () => {
    const result: InstallSkillResult = {
      installed: [],
      already: [{ name: 'bar', effectiveName: 'bar' }],
      conflicts: [{ name: 'baz', existingEffectiveName: 'baz_old' }],
    }
    const installSkill = vi.fn<InstallSkillFn>().mockResolvedValue(result)

    const out = await installSkillToolHandler(installSkill, { type: 'git', loc: 'https://github.com/x/y' })

    expect(JSON.parse(out.content[0].text)).toEqual(result)
  })
})

// ── 原 createSkillToolHandler 测试（保留）────────────────────────────────────

it('createSkillToolHandler 调 createSkill 回调 + 结果进 content text', async () => {
  const createSkill = vi.fn().mockReturnValue({ status: 'created' as const, name: 'foo', effectiveName: 'foo' })
  const out = await createSkillToolHandler(createSkill, { name: 'foo', description: 'd', body: 'b' })
  expect(createSkill).toHaveBeenCalledWith({ name: 'foo', description: 'd', body: 'b' })
  expect(out.content[0].text).toContain('created')
})

// ── buildBuiltinToolsMcp 测试（原 buildInstallSkillMcp 改名）─────────────────

describe('buildBuiltinToolsMcp', () => {
  it('返回非空对象（type=sdk + name + instance）且不抛', () => {
    const installSkill = vi.fn<InstallSkillFn>()
    const createSkill = vi.fn().mockReturnValue({ status: 'created' as const, name: 'foo', effectiveName: 'foo' })
    const cli: CliMcpDeps = {
      list: vi.fn(),
      install: vi.fn(),
      addCustom: vi.fn(),
      removeCustom: vi.fn(),
      checkUpdates: vi.fn(),
      update: vi.fn(),
    }
    const mcp = buildBuiltinToolsMcp({ installSkill, createSkill, cli })

    expect(mcp).toBeTruthy()
    expect(mcp.type).toBe('sdk')
    expect(mcp.name).toBe('agent-shell')
    // McpSdkServerConfigWithInstance 含 instance（McpServer 对象）
    expect(mcp.instance).toBeDefined()
  })

  it('不传 cli 时也不抛、正常返回', () => {
    const installSkill = vi.fn<InstallSkillFn>()
    const createSkill = vi.fn().mockReturnValue({ status: 'created' as const, name: 'foo', effectiveName: 'foo' })
    const mcp = buildBuiltinToolsMcp({ installSkill, createSkill })
    expect(mcp.type).toBe('sdk')
    expect(mcp.name).toBe('agent-shell')
  })
})

// ── CLI handler 纯函数测试 ────────────────────────────────────────────────────

function makeCli(): CliMcpDeps {
  return {
    list: vi.fn(),
    install: vi.fn(),
    addCustom: vi.fn(),
    removeCustom: vi.fn(),
    checkUpdates: vi.fn(),
    update: vi.fn(),
  }
}

describe('cliListToolHandler', () => {
  it('text 格式：输出「name(已装 vX): summary」每行', async () => {
    const cli = makeCli()
    vi.mocked(cli.list).mockResolvedValue([
      { id: 'codex', name: 'codex', summary: 'OpenAI Codex CLI', installed: true, version: '1.2.3', custom: false },
      { id: 'aider', name: 'aider', summary: 'AI pair programmer', installed: false, version: null, custom: false },
    ])
    const out = await cliListToolHandler(cli, { format: 'text' })
    expect(cli.list).toHaveBeenCalled()
    expect(out.content[0].type).toBe('text')
    const text = out.content[0].text
    expect(text).toContain('codex(已装 v1.2.3): OpenAI Codex CLI')
    expect(text).toContain('aider(未装): AI pair programmer')
  })

  it('text 格式：版本为 null 时显示「已装 v?」', async () => {
    const cli = makeCli()
    vi.mocked(cli.list).mockResolvedValue([
      { id: 'tool', name: 'tool', summary: 'Some tool', installed: true, version: null, custom: false },
    ])
    const out = await cliListToolHandler(cli, { format: 'text' })
    expect(out.content[0].text).toContain('已装 v?')
  })

  it('json 格式：返回 JSON 数组', async () => {
    const cli = makeCli()
    const rows = [{ id: 'x', name: 'x', summary: 's', installed: false, version: null, custom: false }]
    vi.mocked(cli.list).mockResolvedValue(rows)
    const out = await cliListToolHandler(cli, { format: 'json' })
    expect(JSON.parse(out.content[0].text)).toEqual(rows)
  })
})

describe('cliInstallToolHandler', () => {
  it('透传 id/method/description 给 cli.install，序列化结果', async () => {
    const cli = makeCli()
    vi.mocked(cli.install).mockResolvedValue({ ok: true, output: 'installed', version: '2.0' })
    const out = await cliInstallToolHandler(cli, { id: 'codex', method: 'brew', description: '用于代码生成' })
    expect(cli.install).toHaveBeenCalledWith('codex', { method: 'brew', description: '用于代码生成' })
    const result = JSON.parse(out.content[0].text)
    expect(result.ok).toBe(true)
    expect(result.version).toBe('2.0')
  })

  it('method/description 可省略', async () => {
    const cli = makeCli()
    vi.mocked(cli.install).mockResolvedValue({ ok: false, output: 'error' })
    await cliInstallToolHandler(cli, { id: 'aider' })
    expect(cli.install).toHaveBeenCalledWith('aider', { method: undefined, description: undefined })
  })
})

describe('cliAddToolHandler', () => {
  it('透传 binPath/name/description 给 cli.addCustom，序列化结果', async () => {
    const cli = makeCli()
    const custom = { id: 'c1', name: 'mytool', binName: 'mytool', binPath: '/usr/local/bin/mytool', version: null, description: '自定义工具', createdAt: 0 }
    vi.mocked(cli.addCustom).mockResolvedValue(custom)
    const out = await cliAddToolHandler(cli, { binPath: '/usr/local/bin/mytool', name: 'mytool', description: '自定义工具' })
    expect(cli.addCustom).toHaveBeenCalledWith({ binPath: '/usr/local/bin/mytool', name: 'mytool', description: '自定义工具' })
    expect(JSON.parse(out.content[0].text)).toEqual(custom)
  })

  it('name/description 可省略', async () => {
    const cli = makeCli()
    vi.mocked(cli.addCustom).mockResolvedValue({ id: 'c2', name: 'foo', binName: 'foo', binPath: '/bin/foo', version: null, createdAt: 0 })
    await cliAddToolHandler(cli, { binPath: '/bin/foo' })
    expect(cli.addCustom).toHaveBeenCalledWith({ binPath: '/bin/foo', name: undefined, description: undefined })
  })
})

describe('cliRemoveToolHandler', () => {
  it('调 cli.removeCustom(id)，返回 {ok:true, id}', async () => {
    const cli = makeCli()
    const out = await cliRemoveToolHandler(cli, { id: 'c1' })
    expect(cli.removeCustom).toHaveBeenCalledWith('c1')
    const result = JSON.parse(out.content[0].text)
    expect(result.ok).toBe(true)
    expect(result.id).toBe('c1')
  })
})

describe('cliCheckUpdatesToolHandler', () => {
  it('调 cli.checkUpdates()，序列化结果数组', async () => {
    const cli = makeCli()
    const updates = [{ name: 'codex', id: 'codex', current: '1.0', latest: '2.0', method: 'brew' }]
    vi.mocked(cli.checkUpdates).mockResolvedValue(updates)
    const out = await cliCheckUpdatesToolHandler(cli)
    expect(cli.checkUpdates).toHaveBeenCalled()
    expect(JSON.parse(out.content[0].text)).toEqual(updates)
  })
})

describe('cliUpdateToolHandler', () => {
  it('传 id 时用 id 调 cli.update（id 优先于 name）', async () => {
    const cli = makeCli()
    vi.mocked(cli.update).mockResolvedValue({ ok: true, output: 'updated', version: '3.0' })
    const out = await cliUpdateToolHandler(cli, { id: 'codex', name: 'codex-alt' })
    expect(cli.update).toHaveBeenCalledWith('codex')
    const result = JSON.parse(out.content[0].text)
    expect(result.ok).toBe(true)
    expect(result.version).toBe('3.0')
  })

  it('无 id 时用 name 调 cli.update', async () => {
    const cli = makeCli()
    vi.mocked(cli.update).mockResolvedValue({ ok: true, output: 'updated' })
    await cliUpdateToolHandler(cli, { name: 'aider' })
    expect(cli.update).toHaveBeenCalledWith('aider')
  })

  it('id 和 name 都缺时传空字符串', async () => {
    const cli = makeCli()
    vi.mocked(cli.update).mockResolvedValue({ ok: false, output: 'not found' })
    await cliUpdateToolHandler(cli, {})
    expect(cli.update).toHaveBeenCalledWith('')
  })
})
