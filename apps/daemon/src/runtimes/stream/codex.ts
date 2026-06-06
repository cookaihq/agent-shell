import type { AgentEvent } from '@agent-shell/contracts'
import { emit } from './internal'

/** 一行 codex --json → 0..n 个内部事件。解析失败/忽略类/非法事件 → 跳过。 */
export function parseCodexLine(line: string): AgentEvent[] {
  let o: any
  try { o = JSON.parse(line) } catch { return [] }
  if (!o || typeof o !== 'object') return []
  const out: AgentEvent[] = []
  switch (o.type) {
    case 'item.started': {
      const it = o.item
      if (it?.type === 'command_execution') {
        // codex 的 command_execution 无工具名；'shell' 是归一常量，真实命令保留在 input.command；
        // tool:'bash' 是中立种类，renderer 按它渲染（不依赖 kindOf('shell')，隔离 Agent 原生名）。
        emit(out, { type: 'tool_use', id: it.id, name: 'shell', input: { command: it.command }, tool: 'bash' })
      }
      break
    }
    case 'item.completed': {
      const it = o.item
      if (it?.type === 'command_execution') {
        emit(out, { type: 'tool_result', toolUseId: it.id, ok: it.exit_code === 0, content: it.aggregated_output ?? '' })
      } else if (it?.type === 'agent_message') {
        emit(out, { type: 'message', text: it.text ?? '' })
      }
      // codex reasoning item 形状未捕获 → 暂不处理（M2 forward-gap）
      break
    }
    case 'turn.completed': {
      emit(out, { type: 'usage', inputTokens: o.usage?.input_tokens ?? 0, outputTokens: o.usage?.output_tokens ?? 0 })
      emit(out, { type: 'turn_end', stopReason: 'completed' })
      break
    }
    case 'turn.failed': {
      // codex 失败终结：error 行（含 Reconnecting 重试）是瞬态通知、忽略；turn.failed 才是终结
      emit(out, { type: 'turn_end', stopReason: 'failed' })
      break
    }
    // thread.started / turn.started → 忽略
  }
  return out
}
