import { createClaudeParser, parseClaudeLine } from '../stream'
import type { BuildArgsOpts, RuntimeAgentDef } from '../types'

/** claude 引擎声明（参数/格式/认证均来自 M3 起草前真机实测，见计划「已查证的真实行为」）。 */
export const claudeDef: RuntimeAgentDef = {
  engine: 'claude',
  bin: 'claude',
  promptInputFormat: 'stream-json',
  closeStdinAfterPrompt: false,   // 常驻进程，关 stdin 是 M4 的活
  turnBoundary: 'event',          // result/turn_end 划界，不靠进程退出
  authStrategy: { apiKeyEnv: 'ANTHROPIC_API_KEY', baseUrlEnv: 'ANTHROPIC_BASE_URL', altKeyEnv: 'ANTHROPIC_AUTH_TOKEN' },
  buildArgs(opts: BuildArgsOpts): string[] {
    const args = [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages',
      '--model', opts.model,
    ]
    // headless（-p）下没有授权交互通道，default 模式会把写操作/mkdir 一律自动拒。
    // 对齐 open-design：无条件写死 bypassPermissions，绕过所有权限检查让写操作放行。
    args.push('--permission-mode', 'bypassPermissions')
    for (const d of opts.addDirs ?? []) args.push('--add-dir', d)   // 授权读项目外目录
    if (opts.resumableId) args.push('--resume', opts.resumableId)
    return args
  },
  formatPrompt(text: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n'
  },
  parseLine: parseClaudeLine,
  // 流式 progress 需跨行累计 → 提供 per-run 有状态解析器；调度器每 turn 起一个实例，状态隔离。
  createParser: createClaudeParser,
  extractResumableId(line: string): string | undefined {
    try { const o = JSON.parse(line); return typeof o?.session_id === 'string' ? o.session_id : undefined }
    catch { return undefined }
  },
}
