import { parseCodexLine } from '../stream'
import type { BuildArgsOpts, RuntimeAgentDef } from '../types'

/** codex 引擎声明（参数/格式/认证均来自 M3 起草前真机实测，见计划「已查证的真实行为」）。 */
export const codexDef: RuntimeAgentDef = {
  engine: 'codex',
  bin: 'codex',
  promptInputFormat: 'text',
  closeStdinAfterPrompt: true,    // [Part A 后 vestigial] 旧 CLI exec 路径用；app-server 路径不读此字段（Phase 6 清 CLI 残留）
  turnBoundary: 'event',          // [Part A] codex 已改 app-server 常驻：一进程跑多 turn，turn/completed 不退、等 pushUser（对齐 claude）。旧 CLI exec 是 'exit'（跑完自退），Phase 6 删 CLI 后此 def 仅服务 app-server
  authStrategy: { apiKeyEnv: 'OPENAI_API_KEY', baseUrlEnv: 'OPENAI_BASE_URL' },
  buildArgs(opts: BuildArgsOpts): string[] {
    // 末尾 '-' = 从 stdin 读 prompt；cwd 由 spawn cwd 绑定，--skip-git-repo-check 兜底非 git 目录
    // resume：exec 选项在前，resume <id> 子命令在后，prompt 走 stdin 的 '-'（实测 codex 0.132.0）
    const base = ['exec', '--json', '--skip-git-repo-check', '-m', opts.model, '-s', opts.sandbox ?? 'workspace-write']
    // 引用项目外路径 → 放行读取。V1 兜底用 disk-full-read-access（偏宽但确定可用；精确可读根待实测收窄）。
    if ((opts.addDirs ?? []).length > 0) base.push('-c', 'sandbox_permissions=["disk-full-read-access"]')
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
