import type { AgentEvent, CodexSubItem } from '@agent-shell/contracts'
import { emit } from '../stream/internal'

/**
 * codex app-server v2 通知 → 中立 AgentEvent 纯映射（Part A · Phase 3.1）。
 *
 * 职责边界（务必看清）：
 * - **纯函数、无状态**。输入单条 app-server 通知 `(method, params)`，输出 0..n 个 AgentEvent。
 *   不碰 process / jsonRpc / 状态机 / 流式累计——那些归 3.3 codexAppServer。
 * - **流式增量不在此处累计**：`item/agentMessage/delta`、`item/reasoning/*Delta` 等 delta 通知
 *   一律返回 []；正文以 `item/completed` 的完整 text 落定（3.3 若要逐字流式，自行用 delta 累计后
 *   再喂完整态，本映射只认 completed 全文）。
 * - **subagent 路由不在此处**（Phase 5）：每条 item 通知都带 `params.threadId`，本函数不读它做归属，
 *   但也不丢——调用方（3.3）拿到原始 `params` 后可自行读 `params.threadId` 做 thread 关联，
 *   本函数只负责「形状映射」，不吞掉调用方需要的信息。
 *
 * 形状来源：probe-notes.md §1+§2（0.137 实测）+ baseline.txt（v2 协议 TS 类型，权威字段名）。
 * fixture 与 spec 冲突时以 fixture 为准（见下各处注释标注的偏离）。
 */
export function mapAppServerEvent(method: string, params: any): AgentEvent[] {
  const out: AgentEvent[] = []
  if (!method) return out

  switch (method) {
    case 'item/started':
      mapItemStarted(out, params?.item)
      break
    case 'item/completed':
      mapItemCompleted(out, params?.item)
      break
    case 'thread/tokenUsage/updated':
      // usage 唯一来源（turn/completed.usage 实测 undefined，见 probe-notes §2）。
      mapTokenUsage(out, params)
      break
    case 'turn/completed':
      // stopReason 取自 turn.status（completed|interrupted|failed|...，baseline TurnStatus）；
      // 偏离 spec「固定 completed」——fixture interrupt.jsonl 实测 status=interrupted，信 fixture。
      mapTurnCompleted(out, params)
      break
    case 'turn/failed':
      // 0.137 未在 fixture 出现独立 turn/failed（失败经 turn/completed.status=failed 或 error 通知），
      // 仍按防御保留：若上游真发，归一为 failed。
      emit(out, { type: 'turn_end', stopReason: 'failed', ...detailOf(params?.error ?? params) })
      break
    case 'error':
      // ErrorNotification {error:{message,...}, willRetry, threadId, turnId}。
      // willRetry=true → 瞬态重连，忽略（对齐 CLI 解析器对 Reconnecting 的处理）；false → 终结失败。
      if (!params?.willRetry) {
        emit(out, { type: 'turn_end', stopReason: 'failed', ...detailOf(params?.error) })
      }
      break
    // 其余通知（thread/started、turn/started、thread/status/changed、account/rateLimits/updated、
    // mcpServer/*、remoteControl/*、item/agentMessage/delta、item/reasoning/*Delta 等）→ 本映射不产事件。
    default:
      break
  }
  return out
}

/** item/started：仅 commandExecution / fileChange 在「开始」时就发 tool_use。 */
function mapItemStarted(out: AgentEvent[], item: any): void {
  if (!item || typeof item !== 'object') return
  switch (item.type) {
    case 'commandExecution':
      // codex 的 command_execution 无工具名；'shell' 是归一常量，真实命令在 input.command；
      // tool:'bash' 是中立种类，renderer 按它渲染（对齐 stream/codex.ts）。
      emit(out, { type: 'tool_use', id: item.id, name: 'shell', input: { command: item.command }, tool: 'bash' })
      break
    case 'fileChange':
      // apply_patch。fixture 未抓到成功态（read-only 被拒，见 probe-notes §2/§3），
      // 字段按 baseline ThreadItem 的 fileChange 分支防御映射：{id, changes[], status}。
      emit(out, { type: 'tool_use', id: item.id, name: 'apply_patch', input: { changes: item.changes ?? [] }, tool: 'edit' })
      break
    // agentMessage/reasoning 的 started 态文本为空 → 不发，正文走 completed。
    default:
      break
  }
}

/** item/completed：正文 / 工具结果在「完成」时落定。 */
function mapItemCompleted(out: AgentEvent[], item: any): void {
  if (!item || typeof item !== 'object') return
  switch (item.type) {
    case 'agentMessage': {
      // 完整全文（流式 delta 的累计终态）。空文本不发（避免空 message）。
      const text = typeof item.text === 'string' ? item.text : ''
      if (text) emit(out, { type: 'message', text })
      break
    }
    case 'reasoning': {
      // summary/content 为 string[]（baseline）；basic fixture 中均为空数组 → 无文本 → 跳过。
      const text = reasoningText(item)
      if (text) emit(out, { type: 'thinking', text })
      break
    }
    case 'commandExecution':
      emit(out, {
        type: 'tool_result',
        toolUseId: item.id,
        ok: item.exitCode === 0,
        content: item.aggregatedOutput ?? '',
      })
      break
    case 'fileChange':
      // PatchApplyStatus: inProgress|completed|failed|declined → ok = completed。
      emit(out, {
        type: 'tool_result',
        toolUseId: item.id,
        ok: item.status === 'completed',
        content: '',
      })
      break
    // userMessage = 回显自己输入 → 忽略；未知 item.type → 忽略（防御 §4.11）。
    default:
      break
  }
}

/** reasoning 文本：优先 summary，回退 content；两者皆为 string[]（baseline ReasoningItem）。 */
function reasoningText(item: any): string {
  const join = (arr: unknown) =>
    Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x).join('\n') : ''
  return join(item.summary) || join(item.content)
}

/**
 * thread/tokenUsage/updated → usage。
 * 真实字段（fixture basic-conversation.jsonl 实测）：
 *   params.tokenUsage.total.{totalTokens,inputTokens,cachedInputTokens,outputTokens,reasoningOutputTokens}（累计）
 *   params.tokenUsage.last.{...}（本轮增量）
 *   params.tokenUsage.modelContextWindow
 * 取 total 作为累计口径；inputTokens 已含 cached（contextTokens = total.inputTokens 直接用）。
 */
function mapTokenUsage(out: AgentEvent[], params: any): void {
  const t = params?.tokenUsage?.total
  if (!t || typeof t !== 'object') return
  const inputTokens = numOr0(t.inputTokens)
  const ev: any = {
    type: 'usage',
    inputTokens,
    outputTokens: numOr0(t.outputTokens),
    contextTokens: inputTokens,
  }
  const ctx = params?.tokenUsage?.modelContextWindow
  if (typeof ctx === 'number' && ctx > 0) {
    ev.contextWindow = ctx
    ev.contextWindowIsAuthoritative = true
  }
  emit(out, ev)
}

function mapTurnCompleted(out: AgentEvent[], params: any): void {
  const turn = params?.turn
  const status = typeof turn?.status === 'string' ? turn.status : 'completed'
  const ev: any = { type: 'turn_end', stopReason: status }
  if (status === 'failed') Object.assign(ev, detailOf(turn?.error))
  emit(out, ev)
}

/** 从 TurnError {message, additionalDetails} 提取可显示 detail（无则不带）。 */
function detailOf(err: any): { detail?: string } {
  const msg = typeof err?.message === 'string' && err.message ? err.message : ''
  const extra = typeof err?.additionalDetails === 'string' && err.additionalDetails ? err.additionalDetails : ''
  const detail = [msg, extra].filter(Boolean).join('\n')
  return detail ? { detail } : {}
}

function numOr0(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0
}

// ── 子线程 item → CodexSubItem（Phase 5 · subagent 路由）────────────────────────
//
// 与上面 mapItemStarted/mapItemCompleted 同一套「形状映射」知识，但产出的是 mini-timeline 块
// （CodexSubItem，归属在外层 CodexSubagentEvent 的 threadId），不是带 parentToolUseId 的共享事件——
// 子线程内容**不**进主时间线（spec §4.2）。调用方（codexAppServer）按 phase='item' 包一层 threadId。
//
// phase 区分（mirror 主线 started/completed 的分工）：
//   - started=true：仅 commandExecution / fileChange 在「开始」就给一个 tool_use 块（占位，后续 result 补）。
//   - started=false（completed）：agentMessage→message、reasoning→thinking、commandExecution/fileChange→tool_result。
// 无可呈现内容（空文本 / 未知 type / userMessage 回显 / collabAgentToolCall）→ 返回 null（调用方跳过）。

/** 子线程 item 通知 → 一个 CodexSubItem 块（无可呈现内容时 null）。`started` 区分 item/started vs item/completed。 */
export function mapItemToSubItem(item: any, started: boolean): CodexSubItem | null {
  if (!item || typeof item !== 'object') return null
  if (started) {
    switch (item.type) {
      case 'commandExecution':
        return { kind: 'tool_use', id: item.id, name: 'shell', input: { command: item.command }, tool: 'bash' }
      case 'fileChange':
        return { kind: 'tool_use', id: item.id, name: 'apply_patch', input: { changes: item.changes ?? [] }, tool: 'edit' }
      default:
        return null
    }
  }
  switch (item.type) {
    case 'agentMessage': {
      const text = typeof item.text === 'string' ? item.text : ''
      return text ? { kind: 'message', text } : null
    }
    case 'reasoning': {
      const text = reasoningText(item)
      return text ? { kind: 'thinking', text } : null
    }
    case 'commandExecution':
      return { kind: 'tool_result', toolUseId: item.id, ok: item.exitCode === 0, content: item.aggregatedOutput ?? '' }
    case 'fileChange':
      return { kind: 'tool_result', toolUseId: item.id, ok: item.status === 'completed', content: '' }
    // userMessage 回显 / collabAgentToolCall / 未知 type → 不产块（防御 §4.11）。
    default:
      return null
  }
}
