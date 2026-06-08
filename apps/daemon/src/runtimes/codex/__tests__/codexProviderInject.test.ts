import { describe, it, expect } from 'vitest'
import { runCodexAppServerTurn, buildCodexProviderArgs, buildCodexAutomationMcpArgs, type CodexAppServerTurnOpts } from '../codexAppServer'
import { fakeCodexClient } from './fakeCodexClient'
import type { ProviderCreds } from '../../types'

function baseOpts(over: Partial<CodexAppServerTurnOpts>): CodexAppServerTurnOpts {
  return {
    cwd: '/work', model: 'gpt-5.5', prompt: 'hi',
    binPath: '/abs/codex', baseEnv: { PATH: '/usr/bin' },
    onEvent: () => {},
    ...over,
  }
}

describe('buildCodexProviderArgs（纯函数 · -c 启动覆盖参数形态）', () => {
  it('按 probe §6 实测形态拼 -c：model_provider + base_url(带引号) + wire_api + env_key', () => {
    const args = buildCodexProviderArgs({ providerName: 'foxapi', baseUrl: 'https://api.foxapi.cc/v1', wireApi: 'responses' })
    expect(args).toEqual([
      '-c', 'model_provider=foxapi',
      '-c', 'model_providers.foxapi.name="foxapi"',
      '-c', 'model_providers.foxapi.base_url="https://api.foxapi.cc/v1"',
      '-c', 'model_providers.foxapi.wire_api=responses',
      '-c', 'model_providers.foxapi.env_key=OPENAI_API_KEY',
    ])
  })

  it('wire_api=chat 透传', () => {
    const args = buildCodexProviderArgs({ providerName: 'mygw', baseUrl: 'https://gw.x/v1', wireApi: 'chat' })
    expect(args).toContain('model_providers.mygw.wire_api=chat')
  })

  it('含空格/特殊字符的名 → config key 折成下划线（TOML 裸键安全），展示名原样写进 .name 并转义引号', () => {
    const args = buildCodexProviderArgs({ providerName: '我的 中转"站', baseUrl: 'https://b/v1', wireApi: 'responses' })
    // key 段不含空格/引号/CJK（折成下划线）；'我的 中转"站' = 7 字符 → 7 下划线
    expect(args).toContain('model_provider=_______')
    const nameArg = args.find((a) => a.includes('.name='))!
    expect(nameArg).toContain('我的 中转\\"站')  // 展示名保留原文，引号转义
  })

  it('纯符号名 → key 兜底为 provider', () => {
    const args = buildCodexProviderArgs({ providerName: '!!!', baseUrl: 'https://b/v1', wireApi: 'chat' })
    expect(args).toContain('model_provider=___')
  })
})

describe('runCodexAppServerTurn · 7.2 自定义 Provider -c 注入通路', () => {
  it('creds.codex 存在 → spawn args = [app-server, ...providerArgs]，key 进 OPENAI_API_KEY，不写 OPENAI_BASE_URL', async () => {
    const h = fakeCodexClient()
    const creds: ProviderCreds = {
      apiKey: 'sk-fox', keyEnv: 'api_key',
      codex: { providerName: 'foxapi', baseUrl: 'https://api.foxapi.cc/v1', wireApi: 'responses' },
    }
    runCodexAppServerTurn(baseOpts({ creds, clientFactory: h.factory }))
    await Promise.resolve()
    const cbs = h.current().cbs
    // 起始子命令仍是 app-server，其后追加 -c 覆盖
    expect(cbs.args[0]).toBe('app-server')
    expect(cbs.args).toEqual([
      'app-server',
      '-c', 'model_provider=foxapi',
      '-c', 'model_providers.foxapi.name="foxapi"',
      '-c', 'model_providers.foxapi.base_url="https://api.foxapi.cc/v1"',
      '-c', 'model_providers.foxapi.wire_api=responses',
      '-c', 'model_providers.foxapi.env_key=OPENAI_API_KEY',
    ])
    // key 经 env 注入（env_key=OPENAI_API_KEY）
    expect(cbs.env.OPENAI_API_KEY).toBe('sk-fox')
    // base_url 由 -c 承载，不再走 env（避免双重配置）
    expect(cbs.env.OPENAI_BASE_URL).toBeUndefined()
  })

  it('无 creds（default=cli-login）→ 不注入任何 -c，args 恒 [app-server]，复用 ~/.codex', async () => {
    const h = fakeCodexClient()
    runCodexAppServerTurn(baseOpts({ clientFactory: h.factory }))
    await Promise.resolve()
    expect(h.current().cbs.args).toEqual(['app-server'])
  })

  it('creds 无 codex 扩展（如 official-key 形态）→ 不拼 -c（codex 自定义注入仅在 codex 扩展在场时启用）', async () => {
    const h = fakeCodexClient()
    const creds: ProviderCreds = { apiKey: 'sk-x', keyEnv: 'api_key' }
    runCodexAppServerTurn(baseOpts({ creds, clientFactory: h.factory }))
    await Promise.resolve()
    expect(h.current().cbs.args).toEqual(['app-server'])
    expect(h.current().cbs.env.OPENAI_API_KEY).toBe('sk-x')
  })

  it('显式传入 args（如未来叠加）与 provider -c 并存：providerArgs 追加在末尾', async () => {
    const h = fakeCodexClient()
    const creds: ProviderCreds = { apiKey: 'k', codex: { providerName: 'p', baseUrl: 'https://b/v1', wireApi: 'chat' } }
    runCodexAppServerTurn(baseOpts({ creds, args: ['app-server', '-c', 'foo=bar'], clientFactory: h.factory }))
    await Promise.resolve()
    expect(h.current().cbs.args).toEqual([
      'app-server', '-c', 'foo=bar',
      '-c', 'model_provider=p',
      '-c', 'model_providers.p.name="p"',
      '-c', 'model_providers.p.base_url="https://b/v1"',
      '-c', 'model_providers.p.wire_api=chat',
      '-c', 'model_providers.p.env_key=OPENAI_API_KEY',
    ])
  })
})

describe('runCodexAppServerTurn · 7.1 默认复用 ~/.codex（不动 CODEX_HOME）', () => {
  it('spawn env 不设置 CODEX_HOME（让用户既有 ~/.codex 的 foxapi/登录自动生效）', async () => {
    const h = fakeCodexClient()
    runCodexAppServerTurn(baseOpts({ clientFactory: h.factory }))
    await Promise.resolve()
    expect('CODEX_HOME' in h.current().cbs.env).toBe(false)
  })

  it('继承环境里已有 CODEX_HOME → 原样透传，绝不被 clobber', async () => {
    const h = fakeCodexClient()
    runCodexAppServerTurn(baseOpts({ baseEnv: { PATH: '/usr/bin', CODEX_HOME: '/custom/codex' }, clientFactory: h.factory }))
    await Promise.resolve()
    expect(h.current().cbs.env.CODEX_HOME).toBe('/custom/codex')
  })

  it('注入自定义 Provider 时也不碰 CODEX_HOME（-c 覆盖是进程级、不改 CODEX_HOME）', async () => {
    const h = fakeCodexClient()
    const creds: ProviderCreds = { apiKey: 'k', codex: { providerName: 'p', baseUrl: 'https://b/v1', wireApi: 'responses' } }
    runCodexAppServerTurn(baseOpts({ baseEnv: { PATH: '/usr/bin', CODEX_HOME: '/custom/codex' }, creds, clientFactory: h.factory }))
    await Promise.resolve()
    expect(h.current().cbs.env.CODEX_HOME).toBe('/custom/codex')
  })
})

describe('buildCodexAutomationMcpArgs（纯函数 · create_automation stdio MCP -c 形态）', () => {
  it('编成 -c mcp_servers.automation.command/args/env（TOML）', () => {
    const args = buildCodexAutomationMcpArgs('/abs/automation-mcp.bundle.mjs')
    expect(args).toEqual([
      '-c', 'mcp_servers.automation.command="node"',
      '-c', 'mcp_servers.automation.args=["/abs/automation-mcp.bundle.mjs"]',
      '-c', 'mcp_servers.automation.env={ AGENT_SHELL_MCP_ENTRY = "1" }',
    ])
  })
})

describe('runCodexAppServerTurn · create_automation MCP 注入通路（§10）', () => {
  it('automationMcpEntry 存在 → spawn args 含 mcp_servers.automation.*（叠加在 app-server 后、provider 前）', async () => {
    const h = fakeCodexClient()
    const creds: ProviderCreds = { apiKey: 'k', codex: { providerName: 'p', baseUrl: 'https://b/v1', wireApi: 'chat' } }
    runCodexAppServerTurn(baseOpts({ automationMcpEntry: '/abs/automation-mcp.bundle.mjs', creds, clientFactory: h.factory }))
    await Promise.resolve()
    expect(h.current().cbs.args).toEqual([
      'app-server',
      '-c', 'mcp_servers.automation.command="node"',
      '-c', 'mcp_servers.automation.args=["/abs/automation-mcp.bundle.mjs"]',
      '-c', 'mcp_servers.automation.env={ AGENT_SHELL_MCP_ENTRY = "1" }',
      '-c', 'model_provider=p',
      '-c', 'model_providers.p.name="p"',
      '-c', 'model_providers.p.base_url="https://b/v1"',
      '-c', 'model_providers.p.wire_api=chat',
      '-c', 'model_providers.p.env_key=OPENAI_API_KEY',
    ])
  })

  it('无 automationMcpEntry → 不注入 mcp_servers（恒 [app-server]）', async () => {
    const h = fakeCodexClient()
    runCodexAppServerTurn(baseOpts({ clientFactory: h.factory }))
    await Promise.resolve()
    expect(h.current().cbs.args.some((a) => a.includes('mcp_servers'))).toBe(false)
    expect(h.current().cbs.args).toEqual(['app-server'])
  })
})
