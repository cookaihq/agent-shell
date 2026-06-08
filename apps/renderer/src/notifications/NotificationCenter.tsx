// NotificationCenter.tsx — 右上角铃铛 + 下拉通知面板（T8）。挂在 chrome-right。
//
// DOM 结构 1:1 复刻原型 renderChrome 的 .rmd-bell-wrap：
//   button.rmd-bell（铃铛 + .rmd-bell-dot 红点，has-unread 控制红点显隐）
//   + .menu.rmd-bell-pop（.rmd-bell-head「通知」+「全部已读」；列表渲染每条 .rmd-notif）。
// 注意：原型头部的「试触发」按钮是 demo，真实 app 不做（任务说明明确省略）。
//
// 红点 has-unread = 列表非空。点铃铛开关面板，点外部 / Esc 关。
// 点卡片 → onOpenSession(projectId, sessionId) + 关面板 + dismiss 该条；点 × → 仅 dismiss。
import { useEffect, useRef, useState } from 'react'
import { useNotifications, type ReminderEvent } from './NotificationsContext'

// 关闭按钮 svg（与原型 X 一致）
function CloseIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M18 6 6 18M6 6l12 12" />
    </svg>
  )
}

interface NotifCardProps {
  event: ReminderEvent
  title: string
  msg: string
  onOpen: () => void
  onClose: () => void
}

/** 单条通知卡片（面板列表行 + toast 复用同一结构）。 */
export function NotifCard({ event, title, msg, onOpen, onClose }: NotifCardProps) {
  return (
    <div className="rmd-notif" data-evt={event} onClick={onOpen}>
      <span className={`rmd-n-dot ${event}`} />
      <span className="rmd-n-body">
        <span className="rmd-n-title">{title}</span>
        <span className="rmd-n-msg">{msg}</span>
      </span>
      <button
        className="rmd-n-x"
        type="button"
        title="关闭"
        onClick={(e) => { e.stopPropagation(); onClose() }}
      >
        <CloseIcon />
      </button>
    </div>
  )
}

interface NotificationCenterProps {
  /** 点卡片跳到对应会话（AppNav 的 onOpenAutomationSession）。 */
  onOpenSession: (projectId: string, sessionId: string) => void
}

export function NotificationCenter({ onOpenSession }: NotificationCenterProps) {
  const { notifications, markAllRead, dismiss } = useNotifications()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 点外部 / Esc 关面板（mousedown 捕获，早于卡片 click）。
  useEffect(() => {
    if (!open) return
    const outside = (e: Event) => { if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', outside, true)
    document.addEventListener('keydown', onKey, true)
    return () => {
      document.removeEventListener('mousedown', outside, true)
      document.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  const hasUnread = notifications.length > 0

  return (
    <div className="rmd-bell-wrap" ref={wrapRef}>
      <button
        className={`chrome-icon rmd-bell${hasUnread ? ' has-unread' : ''}`}
        type="button"
        title="通知"
        aria-expanded={open}
        aria-label="通知"
        onClick={() => setOpen((v) => !v)}
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
          <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
        </svg>
        <span className="rmd-bell-dot" />
      </button>
      {open && (
        <div className="menu rmd-bell-pop open">
          <div className="rmd-bell-head">
            <span className="rmd-bell-title">通知</span>
            <button className="rmd-bell-clear" type="button" onClick={markAllRead}>全部已读</button>
          </div>
          {notifications.length === 0
            ? <div className="rmd-bell-empty">暂无通知</div>
            : notifications.map((n) => (
                <NotifCard
                  key={n.id}
                  event={n.event}
                  title={n.title}
                  msg={n.msg}
                  onOpen={() => { onOpenSession(n.projectId, n.sessionId); dismiss(n.id); setOpen(false) }}
                  onClose={() => dismiss(n.id)}
                />
              ))}
        </div>
      )}
    </div>
  )
}
