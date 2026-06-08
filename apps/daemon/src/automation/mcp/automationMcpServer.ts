import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CreateAutomationReq } from '@agent-shell/contracts'
import { openDatabase, defaultDbPath } from '../../db/database'
import { makeAutomationStore, type AutomationStore } from '../automationStore'
import { defaultAutomationsDir } from '../../paths'
import { createAutomationToolHandler } from '../createAutomationTool'

/** 注册 as_create_automation 工具到一个 McpServer（共享底座心智：codex 后续工具往这里追加）。测试可注入 store。 */
export function buildAutomationMcpServer(store: AutomationStore): McpServer {
  const server = new McpServer({ name: 'agent-shell-automation', version: '1.0.0' })
  server.registerTool(
    'as_create_automation',
    {
      description: '创建一个 Agent Shell 定时自动任务（按触发器自动跑提示词或脚本，写入用户的自动任务库）。校验后落库，非法返回 isError。',
      inputSchema: CreateAutomationReq.shape,
    },
    async (args: unknown) => {
      const res = await createAutomationToolHandler(args, { store })
      return { content: res.content, ...(res.isError ? { isError: true } : {}) }
    },
  )
  return server
}

/** 独立进程入口（被 esbuild bundle 后由 codex spawn）：自开 channel DB + store，跑 stdio transport。 */
export async function main(): Promise<void> {
  const db = openDatabase(defaultDbPath())
  db.pragma('busy_timeout = 5000')   // 与 daemon 并发写同一 app.sqlite，避免偶发 SQLITE_BUSY
  const store = makeAutomationStore({ db, automationsDir: () => process.env.AGENT_SHELL_AUTOMATIONS_DIR || defaultAutomationsDir() })
  const server = buildAutomationMcpServer(store)
  await server.connect(new StdioServerTransport())
}

// 作为独立 bundle 执行时启动（被 codex spawn，env AGENT_SHELL_MCP_ENTRY=1）
if (process.env.AGENT_SHELL_MCP_ENTRY === '1') void main()
