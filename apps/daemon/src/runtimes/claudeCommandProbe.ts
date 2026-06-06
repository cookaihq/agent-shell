import type { Options, SlashCommand } from '@anthropic-ai/claude-agent-sdk'
import { sanitizeEnv } from './env'
import { CLAUDE_AUTH } from './claudeSdk'

// 零成本命令探针（参考 Claudian probeRuntimeCommands）：起一个**空 prompt** 的 SDK query，
// 只等 `system/init` 事件就调 supportedCommands() 抓清单，然后 abort。SDK 在 init 阶段只做本地
// 配置解析（扫 cwd 的 .claude/commands、.claude/skills + 用户级 + 内置），**不进 LLM 轮次、不发 API、不花钱**。
// env/spawn 对齐 runClaudeSdkTurn：同样用 sanitizeEnv 构 env、同样**不传** pathToClaudeCodeExecutable
// （claude 的可解析性沿用 daemon entry 的 shellPath 补全后的 PATH），让探针与真实 turn 跑在同一 spawn 环境。
// 已在 daemon 真实环境复验（2026-06-06）：砍成 GUI 精简 PATH 后 augmentedPath 仍恢复出 claude，
// 不传 cliPath 成功到达 init、零成本（仅 hook/init，无 assistant/result）、supportedCommands 返回 63 条。

/** 探针 query 的最小形态：可异步迭代 + supportedCommands()（真实 SDK Query 是其超集，可注入假实现测试）。 */
interface ProbeQuery extends AsyncIterable<unknown> {
  supportedCommands: () => Promise<SlashCommand[]>
}
export type ProbeQueryFn = (args: { prompt: string; options: Options }) => ProbeQuery

export interface ProbeClaudeCommandsOpts {
  cwd: string
  /** 项目外授权目录（→ additionalDirectories）；参与 cwd 缓存指纹。 */
  addDirs?: string[]
  baseEnv?: NodeJS.ProcessEnv
  /** 注入假 query（测试）；默认动态加载真实 SDK query（string prompt 模式）。 */
  queryFn?: ProbeQueryFn
  /** 注入 AbortController（测试观察 abort）；默认内部新建。 */
  abortController?: AbortController
}

/** 零成本探测某 cwd 的斜杠命令清单。任何失败（spawn 失败 / supportedCommands 抛错 / 流未到 init）→ 返回 []（best-effort，不抛）。 */
export async function probeClaudeCommands(opts: ProbeClaudeCommandsOpts): Promise<SlashCommand[]> {
  const env = sanitizeEnv(CLAUDE_AUTH, opts.baseEnv ?? process.env)
  const ac = opts.abortController ?? new AbortController()
  const options: Options = {
    cwd: opts.cwd,
    env: env as Record<string, string | undefined>,
    abortController: ac,
    permissionMode: 'bypassPermissions',
    allowDangerouslySkipPermissions: true,
    // 用 Claude Code 默认系统提示（对齐 runClaudeSdkTurn）——init 阶段仅解析本地配置，不影响零成本。
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    ...(opts.addDirs && opts.addDirs.length ? { additionalDirectories: opts.addDirs } : {}),
  }
  let commands: SlashCommand[] = []
  try {
    const queryFn = opts.queryFn ?? (await loadRealQueryFn())
    const q = queryFn({ prompt: '', options })
    for await (const msg of q) {
      if ((msg as any)?.type === 'system' && (msg as any)?.subtype === 'init') {
        try { commands = await q.supportedCommands() } catch { /* best-effort：拉不到就空 */ }
        ac.abort()
        break   // 关键：只到 init，绝不消费 assistant/result → 不进 LLM 轮次（零成本）
      }
    }
  } catch { /* 探针 best-effort：spawn 失败 / abort 抛错一律吞掉，返回已抓到的（通常空） */ }
  return commands
}

/** 默认走真实 SDK query（动态 import，与 claudeSdk.ts 同一加载方式）。 */
async function loadRealQueryFn(): Promise<ProbeQueryFn> {
  const sdk = await import('@anthropic-ai/claude-agent-sdk')
  return (args) => sdk.query({ prompt: args.prompt, options: args.options }) as unknown as ProbeQuery
}
