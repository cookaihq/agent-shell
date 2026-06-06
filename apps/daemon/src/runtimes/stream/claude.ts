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

/** 从失败 result 行提取可读真因。失败 result 有两种结构，真因位置不同：
 *  - SDKResultSuccess（api_error_status 等）：错误文本在 `result` 字段。
 *  - SDKResultError（error_during_execution / error_max_turns 等）：**无 `result` 字段**，
 *    真因在 `errors: string[]`，错误大类在 `terminal_reason`（prompt_too_long / model_error / image_error…）。
 *  取值优先级：result 文本 → errors[]（必要时前缀 terminal_reason）→ terminal_reason → subtype 兜底。
 *  以前只读 result 然后退回 subtype，导致 error_during_execution 的真因（在 errors[]）被静默吞掉，UI 只剩一句 subtype。 */
function claudeErrDetail(o: any): string | undefined {
  const r = typeof o?.result === 'string' ? o.result.trim() : ''
  if (r) return r
  const errs = Array.isArray(o?.errors)
    ? o.errors.filter((e: unknown): e is string => typeof e === 'string' && e.trim() !== '').map((e: string) => e.trim())
    : []
  const body = errs.join('; ')
  const reason = typeof o?.terminal_reason === 'string' ? o.terminal_reason.trim() : ''
  if (body) return reason ? `${reason}: ${body}` : body
  if (reason) return reason
  return typeof o?.subtype === 'string' ? o.subtype : undefined
}

/** 一行 claude stream-json → 0..n 个内部事件。解析失败/未知/非法事件 → 跳过。 */
export function parseClaudeLine(line: string): AgentEvent[] {
  let o: any
  try { o = JSON.parse(line) } catch { return [] }
  return parseClaudeObject(o)
}

/** 子代理用量字段 camelCase 化（SDK：total_tokens/tool_uses/duration_ms）。无 usage → undefined。 */
function toSubagentUsage(u: any): { totalTokens: number; toolUses: number; durationMs: number } | undefined {
  if (!u || typeof u !== 'object') return undefined
  return {
    totalTokens: typeof u.total_tokens === 'number' ? u.total_tokens : 0,
    toolUses: typeof u.tool_uses === 'number' ? u.tool_uses : 0,
    durationMs: typeof u.duration_ms === 'number' ? u.duration_ms : 0,
  }
}

/** 三类子代理生命周期 system 消息 → 合并的 subagent 事件（spec §2.4/§6）。非这三类 → undefined。 */
function parseTaskSystem(o: any): AgentEvent | undefined {
  const tid = typeof o.task_id === 'string' ? o.task_id : undefined
  if (!tid) return undefined
  const base = {
    type: 'subagent' as const,
    taskId: tid,
    ...(typeof o.tool_use_id === 'string' ? { toolUseId: o.tool_use_id } : {}),
    ...(typeof o.subagent_type === 'string' ? { subagentType: o.subagent_type } : {}),
    ...(typeof o.description === 'string' ? { description: o.description } : {}),
    ...(typeof o.summary === 'string' ? { summary: o.summary } : {}),
    ...(typeof o.skip_transcript === 'boolean' ? { skipTranscript: o.skip_transcript } : {}),
  }
  const usage = toSubagentUsage(o.usage)
  switch (o.subtype) {
    case 'task_started':
      return { ...base, phase: 'started' }
    case 'task_progress':
      return { ...base, phase: 'progress', ...(usage ? { usage } : {}), ...(typeof o.last_tool_name === 'string' ? { lastToolName: o.last_tool_name } : {}) }
    case 'task_notification':
      return { ...base, phase: 'ended', ...(usage ? { usage } : {}), ...(typeof o.status === 'string' ? { status: o.status } : {}) }
    default:
      return undefined
  }
}

/** 对象级入口：已 parse 的 stream-json 对象 → 内部事件。
 *  SDK runtime 直接喂 SDKMessage 对象（assistant/user/result 与 CLI 行同构）复用此逻辑，免去 stringify→parse 往返。
 *  未知/系统对象（system.init / session_state_changed 等）→ 空数组。 */
export function parseClaudeObject(o: any): AgentEvent[] {
  if (!o || typeof o !== 'object') return []
  const out: AgentEvent[] = []
  // parent_tool_use_id 在消息对象顶层（SDKAssistantMessage/SDKUserMessage）：非空 = 子代理消息，挂到每个发出的块上。
  const parent = typeof o.parent_tool_use_id === 'string' ? { parentToolUseId: o.parent_tool_use_id } : {}
  switch (o.type) {
    case 'assistant': {
      const content = Array.isArray(o.message?.content) ? o.message.content : []   // M1：string content 不当数组迭代
      for (const b of content) {
        if (b?.type === 'text') emit(out, { type: 'message', text: b.text ?? '', ...parent })
        // streaming 下最终 thinking 块为空（文本已由 thinking_delta 累计发出）→ 只在非空时发，避免空块/重复
        else if (b?.type === 'thinking' && b.thinking) emit(out, { type: 'thinking', text: b.thinking, ...parent })
        else if (b?.type === 'tool_use') emit(out, { type: 'tool_use', id: b.id, name: b.name, input: b.input, ...parent })
      }
      break
    }
    case 'user': {
      const content = Array.isArray(o.message?.content) ? o.message.content : []
      for (const b of content) {
        if (b?.type === 'tool_result') {
          emit(out, { type: 'tool_result', toolUseId: b.tool_use_id, ok: !b.is_error, content: toText(b.content), ...parent })
        }
      }
      break
    }
    case 'system': {
      // 上下文压缩边界：claude 主动压缩历史 → 外壳据此重置上下文基线 + 插中立分隔（spec §4.4）。
      if (o.subtype === 'compact_boundary') { emit(out, { type: 'context_compacted' }); break }
      // 子代理生命周期三类 system 消息 → subagent 事件；其余 system（init/session_state_changed…）忽略。
      const sub = parseTaskSystem(o)
      if (sub) emit(out, sub)
      break
    }
    case 'result': {
      // 上下文窗口：从 modelUsage 各模型取最大 contextWindow（主模型窗口；权威值替占位）
      const windows = o.modelUsage && typeof o.modelUsage === 'object'
        ? Object.values(o.modelUsage as Record<string, { contextWindow?: number }>).map((m) => m?.contextWindow).filter((n): n is number => typeof n === 'number' && n > 0)
        : []
      const contextWindow = windows.length ? Math.max(...windows) : undefined
      emit(out, { type: 'usage', inputTokens: o.usage?.input_tokens ?? 0, outputTokens: o.usage?.output_tokens ?? 0, costUsd: o.total_cost_usd ?? undefined, ...(contextWindow ? { contextWindow } : {}) })  // I1：null→undefined（optional 拒绝 null）
      // 结构化输出（outputFormat:json_schema）：result.structured_output 有值才发
      if (o.structured_output !== undefined && o.structured_output !== null) emit(out, { type: 'structured_output', data: o.structured_output })
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
// 时间闸（保活）：距上次发出 ≥ 此毫秒数也发一帧——慢输出（token 涨不够 STEP）时数字不至于长时间不动，
// 对齐起因诉求的「实时跳动」手感。与 token 闸是 OR 关系（满足其一即发）。
const EMIT_INTERVAL_MS = 150

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
 * @param now 时钟注入（默认 Date.now）——时间闸节流用，测试可传假时钟精确驱动。
 */
export function createClaudeParser(now: () => number = () => Date.now()): (line: string) => AgentEvent[] {
  const parseObj = createClaudeObjectParser(now)
  return (line: string): AgentEvent[] => {
    let o: any
    try { o = JSON.parse(line) } catch { return [] }
    return parseObj(o)
  }
}

/** 对象级流式解析器：与 createClaudeParser 同逻辑，但吃已 parse 的对象（SDKMessage / SDKPartialAssistantMessage）。
 *  stream_event 边收 delta 边累计 token + 算动作发 progress；assistant/user/result 委托 parseClaudeObject；result 重置累计器。
 *  每个 run 起一个实例 → 状态隔离。 */
export function createClaudeObjectParser(now: () => number = () => Date.now()): (o: any) => AgentEvent[] {
  let tokens = 0
  let lastEmitTokens = -1
  let lastEmitAt = 0
  let activity: ProgressActivity = { kind: 'thinking' }
  let lastActivityKey = ''
  // 累计器 key = `${parent ?? 'main'}:${index}`：开 forwardSubagentText 后多个并行子代理的 block index 都从 0 起，
  // 单按 index 会撞 key 致文本串台 → 用 parent_tool_use_id 命名空间化，主线与各子代理各自独立累计。
  const toolJson = new Map<string, { name: string; json: string }>()
  // 思考文本按块累计：SDK streaming 下最终 assistant 消息的 thinking 块为空（仅 signature），
  // 真文本只在 thinking_delta 里 → 这里累计，content_block_stop 时发 thinking 事件。
  const thinkingText = new Map<string, string>()
  // 思考块起始时间（content_block_start）→ content_block_stop 算 elapsedMs（Issue 17 思考耗时）。
  const thinkingStart = new Map<string, number>()
  // 正文按块累计：逐字流式（text_delta）边收边发 message(streaming:true)，块结束发 message(streaming:false)。
  // 最终 assistant 消息里的 text 块由此去重跳过（已流式发过）。
  const textBuf = new Map<string, string>()
  let lastTextEmitAt = 0
  // 上下文真实占用累计器：result 行 usage 只有 input_tokens（不含 cache），cache 主体在 assistant 逐条 message.usage。
  // 跨 assistant 逐字段 max 合并（对齐 Claudian mergePromptUsage），result 行 emit usage 时算出 contextTokens=三者之和。
  let promptTokens = { input: 0, cacheCreation: 0, cacheRead: 0 }

  const reset = () => {
    tokens = 0; lastEmitTokens = -1; lastEmitAt = 0
    activity = { kind: 'thinking' }; lastActivityKey = ''
    toolJson.clear(); thinkingText.clear(); thinkingStart.clear(); textBuf.clear(); lastTextEmitAt = 0
    promptTokens = { input: 0, cacheCreation: 0, cacheRead: 0 }
  }

  const emitProgress = (out: AgentEvent[], force = false): void => {
    const key = activityKey(activity)
    const t = now()
    // OR：强发 / 活动切换 / token 涨够 STEP / 距上次 ≥ INTERVAL（保活）任一满足即发。
    if (force || key !== lastActivityKey || tokens - lastEmitTokens >= EMIT_TOKEN_STEP || t - lastEmitAt >= EMIT_INTERVAL_MS) {
      out.push({ type: 'progress', tokens, activity })
      lastEmitTokens = tokens
      lastActivityKey = key
      lastEmitAt = t
    }
  }

  // parent = 该流式分片的 parent_tool_use_id（子代理流），用于命名空间化累计 key + 给发出的文本/思考块挂归属。
  const handleStreamEvent = (ev: any, parent?: string): AgentEvent[] => {
    const out: AgentEvent[] = []
    const bk = (i: number): string => `${parent ?? 'main'}:${i}`   // 累计器命名空间 key
    const pp = parent ? { parentToolUseId: parent } : {}            // 发出块的归属字段（子代理流才带）
    switch (ev?.type) {
      case 'content_block_start': {
        const cb = ev.content_block
        if (cb?.type === 'thinking') { activity = { kind: 'thinking' }; if (typeof ev.index === 'number') { thinkingText.set(bk(ev.index), ''); thinkingStart.set(bk(ev.index), now()) } }
        else if (cb?.type === 'text') { activity = { kind: 'responding' }; if (typeof ev.index === 'number') textBuf.set(bk(ev.index), '') }
        else if (cb?.type === 'tool_use') {
          const name = typeof cb.name === 'string' ? cb.name : ''
          activity = { kind: 'tool', tool: name }
          if (typeof ev.index === 'number') toolJson.set(bk(ev.index), { name, json: '' })
        }
        emitProgress(out)
        break
      }
      case 'content_block_delta': {
        const d = ev.delta
        if (d?.type === 'thinking_delta') {
          tokens += typeof d.estimated_tokens === 'number' ? d.estimated_tokens : estChars(d.thinking)
          if (typeof ev.index === 'number' && typeof d.thinking === 'string') thinkingText.set(bk(ev.index), (thinkingText.get(bk(ev.index)) ?? '') + d.thinking)
          activity = { kind: 'thinking' }
          emitProgress(out)
        } else if (d?.type === 'text_delta') {
          tokens += estChars(d.text)
          activity = { kind: 'responding' }
          emitProgress(out)
          // 逐字流式：累计本块正文，节流（≥60ms）发一帧 message(streaming:true)，text 为累计全文
          if (typeof ev.index === 'number' && typeof d.text === 'string') {
            const acc = (textBuf.get(bk(ev.index)) ?? '') + d.text
            textBuf.set(bk(ev.index), acc)
            const t = now()
            if (t - lastTextEmitAt >= 60) { lastTextEmitAt = t; out.push({ type: 'message', text: acc, streaming: true, ...pp }) }
          }
        } else if (d?.type === 'input_json_delta' && typeof ev.index === 'number') {
          const slot = toolJson.get(bk(ev.index))
          if (slot && typeof d.partial_json === 'string') slot.json += d.partial_json
        }
        break
      }
      case 'content_block_stop': {
        // 思考块结束 → 发累计的 thinking 文本（最终 assistant 消息那份是空的，靠这里补上）+ 耗时（Issue 17）
        if (typeof ev.index === 'number' && thinkingText.has(bk(ev.index))) {
          const text = thinkingText.get(bk(ev.index)) ?? ''
          thinkingText.delete(bk(ev.index))
          const startedAt = thinkingStart.get(bk(ev.index))
          thinkingStart.delete(bk(ev.index))
          const elapsedMs = startedAt !== undefined ? Math.max(0, now() - startedAt) : undefined
          if (text) out.push({ type: 'thinking', text, ...(elapsedMs !== undefined ? { elapsedMs } : {}), ...pp })
        }
        // 正文块结束 → 发完整正文 message(streaming:false) 定格本块；下一个文本块会另起
        if (typeof ev.index === 'number' && textBuf.has(bk(ev.index))) {
          const text = textBuf.get(bk(ev.index)) ?? ''
          textBuf.delete(bk(ev.index))
          out.push({ type: 'message', text, streaming: false, ...pp })
        }
        const slot = typeof ev.index === 'number' ? toolJson.get(bk(ev.index)) : undefined
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

  return (o: any): AgentEvent[] => {
    if (!o || typeof o !== 'object') return []
    if (o.type === 'stream_event' && o.event && typeof o.event === 'object') {
      // parent_tool_use_id 在 SDKPartialAssistantMessage 顶层（非 event 内）→ 透传给子代理流的累计与归属。
      return handleStreamEvent(o.event, typeof o.parent_tool_use_id === 'string' ? o.parent_tool_use_id : undefined)
    }
    // assistant 逐条 message.usage 的 cache token 逐字段 max 合并（真实上下文占用主体；result 行不含 cache）
    if (o.type === 'assistant') {
      const u = o.message?.usage
      if (u && typeof u === 'object') {
        const n = (v: unknown): number => (typeof v === 'number' && v > 0 ? v : 0)
        promptTokens = {
          input: Math.max(promptTokens.input, n(u.input_tokens)),
          cacheCreation: Math.max(promptTokens.cacheCreation, n(u.cache_creation_input_tokens)),
          cacheRead: Math.max(promptTokens.cacheRead, n(u.cache_read_input_tokens)),
        }
      }
    }
    let out = parseClaudeObject(o) // assistant/user/result 照旧
    // 正文已由 text_delta 逐字流式 + content_block_stop 定格发出 → 去重：丢弃最终 assistant 消息里的 message(text) 事件
    if (o.type === 'assistant') out = out.filter((e) => e.type !== 'message')
    if (o.type === 'result') {
      // result 行的 usage 事件补 contextTokens(含 cache) + authoritative（contextWindow 来自运行时则权威）
      const contextTokens = promptTokens.input + promptTokens.cacheCreation + promptTokens.cacheRead
      out = out.map((e) => e.type === 'usage'
        ? { ...e, contextTokens, contextWindowIsAuthoritative: e.contextWindow !== undefined }
        : e)
      reset()
    }
    return out
  }
}
