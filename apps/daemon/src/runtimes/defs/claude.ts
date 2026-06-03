import { parseClaudeLine } from '../stream'
import type { BuildArgsOpts, RuntimeAgentDef } from '../types'

/** claude 引擎声明（参数/格式/认证均来自 M3 起草前真机实测，见计划「已查证的真实行为」）。 */
export const claudeDef: RuntimeAgentDef = {
  engine: 'claude',
  bin: 'claude',
  promptInputFormat: 'stream-json',
  closeStdinAfterPrompt: false,   // 常驻进程，关 stdin 是 M4 的活
  turnBoundary: 'event',          // result/turn_end 划界，不靠进程退出
  authStrategy: { apiKeyEnv: 'ANTHROPIC_API_KEY', baseUrlEnv: 'ANTHROPIC_BASE_URL' },
  buildArgs(opts: BuildArgsOpts): string[] {
    const args = [
      '-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose',
      '--include-partial-messages',
      '--model', opts.model,
    ]
    if (opts.permissionMode) args.push('--permission-mode', opts.permissionMode)
    if (opts.resumableId) args.push('--resume', opts.resumableId)
    return args
  },
  formatPrompt(text: string): string {
    return JSON.stringify({ type: 'user', message: { role: 'user', content: [{ type: 'text', text }] } }) + '\n'
  },
  parseLine: parseClaudeLine,
  extractResumableId(line: string): string | undefined {
    try { const o = JSON.parse(line); return typeof o?.session_id === 'string' ? o.session_id : undefined }
    catch { return undefined }
  },
}
