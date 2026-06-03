import type { AgentEvent, ProgressActivity } from '@agent-shell/contracts'
import { emit } from './internal'

/** claude tool_result.content 可为 string 或文本块数组 → 归一为字符串。
 *  注意：富内容（如 image 块）只取文本，非文本块被丢弃（M2 forward-gap）。 */
function toText(c: unknown): string {
  if (typeof c === 'string') return c
  if (Array.isArray(c)) {
    return c.map((b) => (b && typeof (b as { text?: unknown }).text === 'string' ? (b as { text: string }).text : '')).join('')
  }
  return ''
}

/** 从失败 result 行提取可读真因：优先 result 文本（claude 把错误信息放这），退而用 subtype（error_max_turns 等）。 */
function claudeErrDetail(o: any): string | undefined {
  const r = typeof o?.result === 'string' ? o.result.trim() : ''
  if (r) return r
  return typeof o?.subtype === 'string' ? o.subtype : undefined
}

/** 一行 claude stream-json → 0..n 个内部事件。解析失败/未知/非法事件 → 跳过。 */
export function parseClaudeLine(line: string): AgentEvent[] {
  let o: any
  try { o = JSON.parse(line) } catch { return [] }
  if (!o || typeof o !== 'object') return []
  const out: AgentEvent[] = []
  switch (o.type) {
    case 'assistant': {
      const content = Array.isArray(o.message?.content) ? o.message.content : []   // M1：string content 不当数组迭代
      for (const b of content) {
        if (b?.type === 'text') emit(out, { type: 'message', text: b.text ?? '' })
        else if (b?.type === 'thinking') emit(out, { type: 'thinking', text: b.thinking ?? '' })
        else if (b?.type === 'tool_use') emit(out, { type: 'tool_use', id: b.id, name: b.name, input: b.input })
      }
      break
    }
    case 'user': {
      const content = Array.isArray(o.message?.content) ? o.message.content : []
      for (const b of content) {
        if (b?.type === 'tool_result') {
          emit(out, { type: 'tool_result', toolUseId: b.tool_use_id, ok: !b.is_error, content: toText(b.content) })
        }
      }
      break
    }
    case 'result': {
      emit(out, { type: 'usage', inputTokens: o.usage?.input_tokens ?? 0, outputTokens: o.usage?.output_tokens ?? 0, costUsd: o.total_cost_usd ?? undefined })  // I1：null→undefined（optional 拒绝 null）
      // is_error 时统一标 'failed'：真实失败 result 可能 subtype:'success' + stop_reason:'stop_sequence'（看着像正常结束），
      // 只有 is_error/api_error_status 才是失败信号。与 codex turn.failed→'failed' 对称，避免 UI 把失败 turn 当成功。
      // 失败时把真因（result 文本 / subtype，如 error_during_execution / error_max_turns）带进 detail，别静默吞掉。
      emit(out, o.is_error
        ? { type: 'turn_end', stopReason: 'failed', detail: claudeErrDetail(o) }
        : { type: 'turn_end', stopReason: o.stop_reason ?? o.subtype ?? 'end_turn' })
      break
    }
    // system / system.init / hook / rate_limit_event → 忽略
  }
  return out
}

// 估算：约 4 字符 / token（对齐 Claude Code 本机二进制的 chars/4 兜底）。
const estChars = (s: unknown): number => (typeof s === 'string' ? Math.ceil(s.length / 4) : 0)
// 节流闸：累计 token 较上次发出增长 ≥ 此值才再发一帧（活动切换时无视阈值强发）。
const EMIT_TOKEN_STEP = 25

const activityKey = (a: ProgressActivity): string =>
  a.kind === 'tool' ? `tool:${a.tool}:${a.target ?? ''}` : a.kind

/** 工具 input JSON 里挑一个最有信息量的"目标"：文件路径优先，其次命令。解析失败/无 → undefined。 */
function toolTarget(json: string): string | undefined {
  try {
    const o = JSON.parse(json) as Record<string, unknown>
    const t = o.file_path ?? o.path ?? o.command
    return typeof t === 'string' ? t : undefined
  } catch {
    return undefined
  }
}

/**
 * 建一个持有 per-run 累计器的 claude 行解析器。assistant/user/result 行委托 parseClaudeLine（行为不变）；
 * stream_event 行边收 delta 边累计 token 估算 + 算当前动作，阈值节流后发 progress（瞬时、不落库）。
 * result 行重置累计器，下一轮归零。每个 run 起一个实例 → 状态天然隔离。
 */
export function createClaudeParser(): (line: string) => AgentEvent[] {
  let tokens = 0
  let lastEmitTokens = -1
  let activity: ProgressActivity = { kind: 'thinking' }
  let lastActivityKey = ''
  const toolJson = new Map<number, { name: string; json: string }>()

  const reset = () => {
    tokens = 0; lastEmitTokens = -1
    activity = { kind: 'thinking' }; lastActivityKey = ''
    toolJson.clear()
  }

  const emitProgress = (out: AgentEvent[], force = false): void => {
    const key = activityKey(activity)
    if (force || key !== lastActivityKey || tokens - lastEmitTokens >= EMIT_TOKEN_STEP) {
      out.push({ type: 'progress', tokens, activity })
      lastEmitTokens = tokens
      lastActivityKey = key
    }
  }

  const handleStreamEvent = (ev: any): AgentEvent[] => {
    const out: AgentEvent[] = []
    switch (ev?.type) {
      case 'content_block_start': {
        const cb = ev.content_block
        if (cb?.type === 'thinking') activity = { kind: 'thinking' }
        else if (cb?.type === 'text') activity = { kind: 'responding' }
        else if (cb?.type === 'tool_use') {
          const name = typeof cb.name === 'string' ? cb.name : ''
          activity = { kind: 'tool', tool: name }
          if (typeof ev.index === 'number') toolJson.set(ev.index, { name, json: '' })
        }
        emitProgress(out)
        break
      }
      case 'content_block_delta': {
        const d = ev.delta
        if (d?.type === 'thinking_delta') {
          tokens += typeof d.estimated_tokens === 'number' ? d.estimated_tokens : estChars(d.thinking)
          activity = { kind: 'thinking' }
          emitProgress(out)
        } else if (d?.type === 'text_delta') {
          tokens += estChars(d.text)
          activity = { kind: 'responding' }
          emitProgress(out)
        } else if (d?.type === 'input_json_delta' && typeof ev.index === 'number') {
          const slot = toolJson.get(ev.index)
          if (slot && typeof d.partial_json === 'string') slot.json += d.partial_json
        }
        break
      }
      case 'content_block_stop': {
        const slot = typeof ev.index === 'number' ? toolJson.get(ev.index) : undefined
        if (slot?.name) {
          const target = toolTarget(slot.json)
          activity = { kind: 'tool', tool: slot.name, ...(target ? { target } : {}) }
          emitProgress(out, true) // 工具目标确定 → 强制刷一帧
        }
        break
      }
      // message_start / message_delta / message_stop：不影响状态行，忽略
    }
    return out
  }

  return (line: string): AgentEvent[] => {
    let o: any
    try { o = JSON.parse(line) } catch { return [] }
    if (!o || typeof o !== 'object') return []
    if (o.type === 'stream_event' && o.event && typeof o.event === 'object') {
      return handleStreamEvent(o.event)
    }
    const out = parseClaudeLine(line) // assistant/user/result 照旧
    if (o.type === 'result') reset()
    return out
  }
}
