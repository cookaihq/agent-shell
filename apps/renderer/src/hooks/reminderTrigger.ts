// reminderTrigger.ts — 提醒（Reminders）触发逻辑（T7）
//
// 纯函数 fireReminder：给定一个 useAgentStream 事件 + 当前上下文 + 副作用依赖，
// 按「事件 → key → 渠道 → 失焦门控」决定要不要响、响哪几路。把判定与副作用注入
// 拆开（DI），便于单测（mock notify/playSound/showReminder/hasFocus）。
//
// 触发模型（spec §3 / §9，决策 A/C）：
//   事件 → key：
//     permission_request / ask_user_question → 'attention'（卡住等授权/回答）
//     turn_end 且 stopReason ∉ {failed, aborted} → 'complete'
//     turn_end 且 stopReason === 'failed' → 'failed'（带 detail 真因）
//     turn_end aborted → 不提醒（用户自己停的）
//   前置：config.enabled 为假 → 整体不响（决策 C：无配置=enabled:false）。
//   渠道：config.events[key].channels（为空 → 该事件不响）。
//     inapp  → notify()       不受失焦限制（决策 A：盯着屏幕也要看到 APP 内卡片）
//     audio  → playSound()    仅失焦才响
//     system → showReminder() 仅失焦才响
//   不做节流（多事件多响，spec §3）。
import type { RemindersConfig, ReminderNotify, SoundCfg } from '@agent-shell/contracts'
import type { AgentEvent } from '../api/types'

/** 提醒事件 key（与 RemindersConfig.events / NotificationsContext.ReminderEvent 对齐）。 */
type ReminderKey = 'attention' | 'complete' | 'failed'

/** 触发上下文：当前会话的配置与命名信息（由 Workspace 经 ref 提供最新值，避免 stale 闭包）。 */
export interface ReminderTriggerCtx {
  config: RemindersConfig
  projectId: string
  sessionId: string
  projectName: string
  sessionName: string
}

/** 副作用依赖（DI）：来自 T8 notify / T6 playSound / T5 showReminder / document.hasFocus。 */
export interface ReminderTriggerDeps {
  notify: (input: { event: ReminderKey; projectId: string; sessionId: string; title: string; msg: string }) => void
  playSound: (sound: SoundCfg, projectId?: string) => void
  showReminder: (payload: ReminderNotify) => void
  /** 窗口是否聚焦（通常 () => document.hasFocus()）。audio/system 仅失焦才响。 */
  hasFocus: () => boolean
}

/**
 * 把一个 stream 事件映射到提醒 key；不构成提醒的事件返回 null。
 * - turn_end aborted → null（用户自己停的，不提醒）
 * - turn_end failed → 'failed'；其余 stopReason（end_turn 等）→ 'complete'
 */
function eventToKey(ev: AgentEvent): ReminderKey | null {
  if (ev.type === 'permission_request' || ev.type === 'ask_user_question') return 'attention'
  if (ev.type === 'turn_end') {
    if (ev.stopReason === 'aborted') return null
    if (ev.stopReason === 'failed') return 'failed'
    return 'complete'
  }
  return null
}

/** 生成 inapp/system 共用的标题：「项目名 · 会话名」。 */
function buildTitle(ctx: ReminderTriggerCtx): string {
  return `${ctx.projectName} · ${ctx.sessionName}`
}

/**
 * 生成正文。failed 带 detail 真因（无 detail 退化为「任务失败」）。
 * 文案语义对齐原型 wireBell：attention=需介入、complete=完成、failed=失败+真因。
 */
function buildBody(key: ReminderKey, ev: AgentEvent): string {
  switch (key) {
    case 'attention':
      return '需要你授权 / 选择'
    case 'complete':
      return '会话已完成'
    case 'failed': {
      const detail = ev.type === 'turn_end' ? ev.detail : undefined
      return detail ? `任务失败：${detail}` : '任务失败'
    }
  }
}

/**
 * 触发提醒：纯函数，所有副作用经 deps 注入。
 * 调用方（Workspace 的 useAgentStream 回调）每个事件调一次。
 */
export function fireReminder(ev: AgentEvent, ctx: ReminderTriggerCtx, deps: ReminderTriggerDeps): void {
  const { config } = ctx
  // 前置：整体开关关 → 一概不响（决策 C）
  if (!config.enabled) return

  const key = eventToKey(ev)
  if (!key) return

  const channels = config.events[key].channels
  if (channels.length === 0) return

  const title = buildTitle(ctx)
  const body = buildBody(key, ev)
  const focused = deps.hasFocus()

  // inapp：不受失焦限制（盯着屏幕也要看到 APP 内卡片）
  if (channels.includes('inapp')) {
    deps.notify({ event: key, projectId: ctx.projectId, sessionId: ctx.sessionId, title, msg: body })
  }
  // audio：仅失焦才响
  if (channels.includes('audio') && !focused) {
    deps.playSound(config.events[key].sound, ctx.projectId)
  }
  // system：仅失焦才响
  if (channels.includes('system') && !focused) {
    deps.showReminder({ projectId: ctx.projectId, sessionId: ctx.sessionId, event: key, title, body })
  }
}
