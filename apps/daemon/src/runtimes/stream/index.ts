import type { AgentEvent, Engine } from '@agent-shell/contracts'
import { parseClaudeLine } from './claude'
import { parseCodexLine } from './codex'

export { parseClaudeLine, createClaudeParser } from './claude'
export { parseCodexLine } from './codex'

/** 把整段原始事件流（多行 JSONL）按引擎归一为内部事件序列；坏帧/空行跳过。 */
export function parseStream(text: string, engine: Engine): AgentEvent[] {
  const parseLine = engine === 'claude' ? parseClaudeLine : parseCodexLine
  const out: AgentEvent[] = []
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    out.push(...parseLine(line))
  }
  return out
}
