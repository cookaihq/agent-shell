import { z, CreateAutomationReq } from '@agent-shell/contracts'
import { createSdkMcpServer, tool, type SdkMcpToolDefinition } from '@anthropic-ai/claude-agent-sdk'
import type { InstallSkillReq, InstallSkillResult, CreateSkillReq, CreateSkillResult, CustomCliTool } from '@agent-shell/contracts'
import type { CliToolListRow } from '../clitools/service'

type InstallSkillFn = (req: InstallSkillReq) => Promise<InstallSkillResult>
type CreateSkillFn = (req: CreateSkillReq) => CreateSkillResult | Promise<CreateSkillResult>
/** create_automation 工具回调：= createAutomationToolHandler 绑定 store 后的形状（校验+落库，返回 content/isError）。 */
type CreateAutomationFn = (args: unknown) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>

/**
 * CLI 工具 service 的方法子集，Task 7 会注入真实 CliToolService。
 */
export interface CliMcpDeps {
  list: () => Promise<CliToolListRow[]>
  install: (id: string, opts?: { method?: string; description?: string }) => Promise<{ ok: boolean; output: string; version?: string | null }>
  addCustom: (req: { binPath: string; name?: string; description?: string }) => Promise<CustomCliTool>
  removeCustom: (id: string) => void
  checkUpdates: () => Promise<Array<{ name: string; id: string; current: string; latest?: string; method: string }>>
  update: (idOrName: string) => Promise<{ ok: boolean; output: string; version?: string | null }>
}

/**
 * 工具 handler 纯逻辑（可单测）：调 installSkill，结果序列化进 content text。
 */
export async function installSkillToolHandler(
  installSkill: InstallSkillFn,
  args: InstallSkillReq,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const result = await installSkill(args)
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
}

/**
 * 工具 handler 纯逻辑（可单测）：调 createSkill，结果序列化进 content text。
 * createSkill 同步返回；用 Promise.resolve 兼容同步/异步两种实现。
 */
export async function createSkillToolHandler(
  createSkill: CreateSkillFn,
  args: CreateSkillReq,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const result = await Promise.resolve(createSkill(args))
  return { content: [{ type: 'text' as const, text: JSON.stringify(result) }] }
}

// ── CLI 工具 handler 纯函数（可单测，依赖注入 CliMcpDeps）────────────────────

/**
 * 列出所有已知 CLI 工具及本机安装状态。
 * format=text 时输出人读格式；json 时输出 JSON 数组。
 */
export async function cliListToolHandler(
  cli: CliMcpDeps,
  args: { format: 'text' | 'json' },
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const rows = await cli.list()
  let text: string
  if (args.format === 'json') {
    text = JSON.stringify(rows)
  } else {
    text = rows.map(r => `${r.name}(${r.installed ? '已装 v' + (r.version ?? '?') : '未装'}): ${r.summary}`).join('\n')
  }
  return { content: [{ type: 'text' as const, text }] }
}

/**
 * 按工具 id 安装命令行工具（阻塞跑完），可附带描述备注。
 */
export async function cliInstallToolHandler(
  cli: CliMcpDeps,
  args: { id: string; method?: string; description?: string },
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const r = await cli.install(args.id, { method: args.method, description: args.description })
  return { content: [{ type: 'text' as const, text: JSON.stringify(r) }] }
}

/**
 * 把本机已装、但不在目录里的工具按可执行绝对路径登记进来。
 */
export async function cliAddToolHandler(
  cli: CliMcpDeps,
  args: { binPath: string; name?: string; description?: string },
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const r = await cli.addCustom({ binPath: args.binPath, name: args.name, description: args.description })
  return { content: [{ type: 'text' as const, text: JSON.stringify(r) }] }
}

/**
 * 移除一个已登记的自定义命令行工具。
 */
export async function cliRemoveToolHandler(
  cli: CliMcpDeps,
  args: { id: string },
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  cli.removeCustom(args.id)
  return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, id: args.id }) }] }
}

/**
 * 检查已安装命令行工具的可用更新。
 */
export async function cliCheckUpdatesToolHandler(
  cli: CliMcpDeps,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const ups = await cli.checkUpdates()
  return { content: [{ type: 'text' as const, text: JSON.stringify(ups) }] }
}

/**
 * 把某个命令行工具更新到最新（id 或 name 二选一，id 优先）。
 */
export async function cliUpdateToolHandler(
  cli: CliMcpDeps,
  args: { id?: string; name?: string },
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  const r = await cli.update(args.id ?? args.name ?? '')
  return { content: [{ type: 'text' as const, text: JSON.stringify(r) }] }
}

// ── MCP server 构建 ──────────────────────────────────────────────────────────

/**
 * in-process SDK MCP server，暴露内置工具集：
 *   - as_install_skill / as_create_skill（始终挂载）
 *   - as_create_automation（createAutomation 存在才挂载）
 *   - as_cli_list / as_cli_install / as_cli_add / as_cli_remove /
 *     as_cli_check_updates / as_cli_update（cli 存在才挂载）
 */
export function buildBuiltinToolsMcp(deps: {
  installSkill: InstallSkillFn
  createSkill: CreateSkillFn
  cli?: CliMcpDeps
  createAutomation?: CreateAutomationFn
}) {
  // 宽注解（对齐 SDK：createSdkMcpServer 的 tools 参数即 Array<SdkMcpToolDefinition<any>>）——
  // 否则 const tools = [a,b] 会被推断成「前两元素 schema 的联合数组」，后续 push 异构 schema 的工具会类型不兼容。
  const tools: SdkMcpToolDefinition<any>[] = [
    tool(
      'as_install_skill',
      '把外部 Agent Skill（git 仓库或本地文件夹）安装进 Agent Shell 技能库。按名称+内容指纹判重，返回 installed/already/conflicts。',
      {
        type: z.enum(['git', 'folder']),
        loc: z.string(),
        name: z.string().optional(),
        branch: z.string().optional(),
      },
      (args) => installSkillToolHandler(deps.installSkill, args as InstallSkillReq),
    ),
    tool(
      'as_create_skill',
      '从零创建一个新 Agent Skill 并入 Agent Shell 库。传 name(字母数字-_)/description/body(SKILL.md 正文指令)。撞名返回 conflict、不覆盖。',
      {
        name: z.string(),
        description: z.string(),
        body: z.string(),
      },
      (args) => createSkillToolHandler(deps.createSkill, args as CreateSkillReq),
    ),
  ]

  if (deps.createAutomation) {
    const createAutomation = deps.createAutomation
    tools.push(
      tool(
        'as_create_automation',
        '创建一个 Agent Shell 定时自动任务（按触发器自动跑提示词或脚本，写入用户的自动任务库）。校验后落库，非法返回 isError。',
        CreateAutomationReq.shape,
        (args) => createAutomation(args),
      ),
    )
  }

  if (deps.cli) {
    const cli = deps.cli
    tools.push(
      tool(
        'as_cli_list',
        '列出可用命令行工具目录及本机已装状态。',
        { format: z.enum(['text', 'json']).default('text') },
        (args) => cliListToolHandler(cli, args as { format: 'text' | 'json' }),
      ),
      tool(
        'as_cli_install',
        '按工具 id 在本机安装一个命令行工具（Agent Shell 按当前系统选方式、阻塞跑完）。可传 description 顺手记录用途。',
        { id: z.string(), method: z.string().optional(), description: z.string().optional() },
        (args) => cliInstallToolHandler(cli, args as { id: string; method?: string; description?: string }),
      ),
      tool(
        'as_cli_add',
        '把本机已装、但不在目录里的工具按可执行绝对路径登记进来。可传 description 记录用途。',
        { binPath: z.string(), name: z.string().optional(), description: z.string().optional() },
        (args) => cliAddToolHandler(cli, args as { binPath: string; name?: string; description?: string }),
      ),
      tool(
        'as_cli_remove',
        '移除一个已登记的自定义命令行工具。',
        { id: z.string() },
        (args) => cliRemoveToolHandler(cli, args as { id: string }),
      ),
      tool(
        'as_cli_check_updates',
        '检查已安装命令行工具的可用更新。',
        {},
        () => cliCheckUpdatesToolHandler(cli),
      ),
      tool(
        'as_cli_update',
        '把某个命令行工具更新到最新。id 和 name 二选一，优先用 id。',
        { id: z.string().optional(), name: z.string().optional() },
        (args) => cliUpdateToolHandler(cli, args as { id?: string; name?: string }),
      ),
    )
  }

  return createSdkMcpServer({ name: 'agent-shell', version: '1.0.0', tools })
}
