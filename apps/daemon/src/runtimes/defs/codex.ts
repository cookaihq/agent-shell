import { parseCodexLine } from '../stream'
import type { BuildArgsOpts, RuntimeAgentDef } from '../types'

/** codex 引擎声明（参数/格式/认证均来自 M3 起草前真机实测，见计划「已查证的真实行为」）。 */
export const codexDef: RuntimeAgentDef = {
  engine: 'codex',
  bin: 'codex',
  promptInputFormat: 'text',
  closeStdinAfterPrompt: true,    // 单次：写完 text 关 stdin（EOF）触发执行
  turnBoundary: 'exit',           // 跑完 turn.completed 进程自退
  authStrategy: { apiKeyEnv: 'OPENAI_API_KEY', baseUrlEnv: 'OPENAI_BASE_URL' },
  buildArgs(opts: BuildArgsOpts): string[] {
    // 末尾 '-' = 从 stdin 读 prompt；cwd 由 spawn cwd 绑定，--skip-git-repo-check 兜底非 git 目录
    // resume：exec 选项在前，resume <id> 子命令在后，prompt 走 stdin 的 '-'（实测 codex 0.132.0）
    const base = ['exec', '--json', '--skip-git-repo-check', '-m', opts.model, '-s', opts.sandbox ?? 'workspace-write']
    return opts.resumableId ? [...base, 'resume', opts.resumableId, '-'] : [...base, '-']
  },
  formatPrompt(text: string): string {
    return text
  },
  parseLine: parseCodexLine,
  extractResumableId(line: string): string | undefined {
    try { const o = JSON.parse(line); return o?.type === 'thread.started' && typeof o.thread_id === 'string' ? o.thread_id : undefined }
    catch { return undefined }
  },
}
