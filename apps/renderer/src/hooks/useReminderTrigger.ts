// useReminderTrigger.ts — 把 fireReminder 接到 Workspace 的 useAgentStream 回调（T7 wiring）
//
// 为什么要 ref：useAgentStream 的事件回调是长期存活闭包（连接期内不重建），而提醒配置会变
// （Agent 改 reminders.json → useReminders 经 files-changed 实时重拉），项目名/会话名也会变。
// 直接闭包捕获会读到挂载那刻的陈旧值。这里把最新 ctx 放进 ref，每次 render 刷新 ref.current，
// 返回的 fire() 始终读 ref.current ——确保「Agent 改了配置 → 下次事件按新配置走」（spec §7 实时生效）。
import { useRef, useCallback } from 'react'
import { useReminders } from './useReminders'
import { useNotifications } from '../notifications/NotificationsContext'
import { playSound } from '../utils/reminderSound'
import { fireReminder, type ReminderTriggerCtx } from './reminderTrigger'
import type { AgentEvent } from '../api/types'
import type { AgentShellBridge } from '@agent-shell/contracts'

/** 桌面壳桥（window.agentShell）；浏览器/dev 下为 undefined（system 渠道则静默跳过）。沿用项目既有访问先例。 */
function getBridge(): AgentShellBridge | undefined {
  return (globalThis as { agentShell?: AgentShellBridge }).agentShell
}

interface UseReminderTriggerArgs {
  projectId: string
  sessionId: string
  projectName: string
  sessionName: string
}

/**
 * 返回一个稳定的 fire(ev) 回调：在 Workspace 的 useAgentStream 回调里、现有 dispatch 之外调用，
 * 由它按事件 + 渠道 + 失焦门控触发提醒。
 *
 * config 由内部 useReminders(projectId) 持有（含 files-changed 实时重拉）；ctx 经 ref 持最新值。
 */
export function useReminderTrigger(args: UseReminderTriggerArgs): (ev: AgentEvent) => void {
  const { config } = useReminders(args.projectId)
  const { notify } = useNotifications()

  // 每次 render 把最新 ctx 写进 ref，供长期存活的 fire 闭包读取（防 stale）。
  const ctxRef = useRef<ReminderTriggerCtx>({
    config,
    projectId: args.projectId,
    sessionId: args.sessionId,
    projectName: args.projectName,
    sessionName: args.sessionName,
  })
  ctxRef.current = {
    config,
    projectId: args.projectId,
    sessionId: args.sessionId,
    projectName: args.projectName,
    sessionName: args.sessionName,
  }

  // fire 稳定不变（依赖空）：内部一律读 ctxRef.current + 当下的副作用实现，不捕获快照值。
  return useCallback((ev: AgentEvent) => {
    fireReminder(ev, ctxRef.current, {
      notify,
      playSound,
      showReminder: (payload) => getBridge()?.showReminder(payload),
      hasFocus: () => (typeof document !== 'undefined' ? document.hasFocus() : false),
    })
  }, [notify])
}
