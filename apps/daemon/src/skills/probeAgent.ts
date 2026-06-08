import { ReqSlot } from '@agent-shell/contracts'
import { CLAUDE_AUTH } from '../runtimes/claudeSdk'
import { sanitizeEnv } from '../runtimes/env'
import type { ProviderCreds } from '../runtimes/types'

export interface AgentProbeOpts {
  skillDir: string                   // 技能源目录（cwd，Agent 在此读 SKILL.md + 脚本）
  creds?: ProviderCreds              // 当前 claude provider 凭证（省略=默认登录态）
  /** 注入假 query（测试）；省略走真实 SDK。宽类型允许测试传 AsyncIterable 而不必实现完整 Query 接口。 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  queryFn?: (args?: any) => AsyncIterable<unknown>
}

const PROMPT = [
  'You are analyzing an Agent Skill in the current working directory to determine what secrets/config it needs to RUN.',
  'Read SKILL.md and any scripts here. Identify required configuration:',
  '- environment variables the skill reads (process.env.X, os.environ["X"], `Authorization: Bearer <X>`, etc.)',
  '- external credential files it expects (e.g. ~/.aws/credentials)',
  'End your reply with ONE fenced ```json block: a JSON array of slots.',
  'Each slot: {"kind":"env"|"file","name":"<env var name | file path>","optional":<bool>}.',
  'For kind "file" also set "fileMode":"in-folder"|"external-path". Add "default":"<value>" only if SKILL.md documents one.',
  'Set "optional":true only if the skill works without it. If no config is needed, output [].',
].join('\n')

/** 抽出文本里最后一个 ```json fenced 块并 JSON.parse；失败返回 null。 */
function extractLastJsonBlock(text: string): unknown {
  const re = /```json\s*([\s\S]*?)```/g
  let m: RegExpExecArray | null, last: string | null = null
  while ((m = re.exec(text)) !== null) last = m[1]
  if (last == null) return null
  try { return JSON.parse(last.trim()) } catch { return null }
}

function collectText(msg: unknown): string {
  const m = msg as { type?: string; message?: { content?: Array<{ type?: string; text?: string }> }; result?: string }
  if (m?.type === 'assistant' && Array.isArray(m.message?.content)) {
    return m.message!.content!
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text!)
      .join('')
  }
  if (m?.type === 'result' && typeof m.result === 'string') return m.result
  return ''
}

/** 一次性跑 Agent 读技能、产出精确槽位（提议，不落盘）。只读工具、免授权。解析失败/无块 → []。 */
export async function agentProbeSlots(opts: AgentProbeOpts): Promise<ReqSlot[]> {
  const env = sanitizeEnv(CLAUDE_AUTH, process.env, opts.creds)
  const options = {
    cwd: opts.skillDir,
    env: env as Record<string, string | undefined>,
    allowedTools: ['Read', 'Glob', 'Grep'],
    permissionMode: 'bypassPermissions' as const,
    systemPrompt: { type: 'preset' as const, preset: 'claude_code' as const },
  }
  let q: AsyncIterable<unknown>
  if (opts.queryFn) {
    q = opts.queryFn({ prompt: PROMPT as never, options: options as never }) as AsyncIterable<unknown>
  } else {
    const sdk = await import('@anthropic-ai/claude-agent-sdk')
    q = sdk.query({ prompt: PROMPT as never, options: options as never }) as AsyncIterable<unknown>
  }
  let text = ''
  for await (const msg of q) text += collectText(msg)

  const parsed = extractLastJsonBlock(text)
  if (!Array.isArray(parsed)) return []
  const out: ReqSlot[] = []
  for (const item of parsed) {
    const r = ReqSlot.safeParse(item)
    if (r.success) out.push(r.data)
  }
  return out
}
