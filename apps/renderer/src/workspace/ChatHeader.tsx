/**
 * ChatHeader.tsx — 聊天区顶部栏
 *
 * DOM 结构 1:1 对照原型 workspace.html L25-48：
 *   .chat-header
 *     .chat-conv[标题 + · N 条消息]
 *     .inline-switcher
 *       .chat-hist-wrap
 *         span.hist-count       — 已完成会话数徽章
 *         button.chat-hicon     — 历史按钮（点击开合 hist-menu 弹窗）
 *         span.hist-running     — 运行中红点（有运行中会话时可见）
 *       .menu.hist-menu         — SessionHistory 弹窗（wirePopover 式，点外部关）
 *     button.chat-hicon         — 新会话按钮「+」→ onNew
 *
 * 徽章逻辑：
 *   hist-count = sessions 中 status=completed 的数量
 *   hist-running = sessions 中当前有运行中（activeRunning）或有 running 态时显示
 */

import { useEffect, useRef, useState } from 'react'
import type { SessionDTO } from '../api/types'
import { SessionHistory } from './SessionHistory'
import { useSettings } from '../settings/SettingsContext'

// ── SVG 图标（inline，1:1 from workspace.html L30, L47）─────────────────────────

const IconHistory = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const IconPlus = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

// ── ChatHeader ────────────────────────────────────────────────────────────────

interface ChatHeaderProps {
  /** 本项目所有会话列表 */
  sessions: SessionDTO[]
  /** 已打开的会话 tab（仅这些排成 tab 条，Issue 23） */
  openSessionIds: string[]
  /** 当前活动会话 ID */
  activeId: string
  /** 当前活动会话是否运行中 */
  activeRunning: boolean
  /** 选择历史会话 */
  onSelect: (id: string) => void
  /** 关闭会话 tab（仅关 tab 不删会话） */
  onCloseTab: (id: string) => void
  /** 新建会话 */
  onNew: () => void
  /** 继续 failed/aborted 会话 */
  onResume: (id: string) => void
  /** 置顶切换（PATCH pinned） */
  onPin: (id: string, pinned: boolean) => void
  /** 重命名（PATCH title） */
  onRename: (id: string, title: string) => void
  /** 真删除会话（连同对话历史，不可恢复）；区别于 onCloseTab（仅关 tab 显示） */
  onDelete: (id: string) => void
  /** 调试模式：当前项目 id（来自 Workspace props） */
  projectId?: string
}

export function ChatHeader({
  sessions,
  openSessionIds,
  activeId,
  activeRunning,
  onSelect,
  onCloseTab,
  onNew,
  onResume,
  onPin,
  onRename,
  onDelete,
  projectId,
}: ChatHeaderProps) {
  const { debugMode } = useSettings()
  const [histOpen, setHistOpen] = useState(false)
  const wrapRef = useRef<HTMLSpanElement>(null)

  // 会话 tab 条（Issue 23）：仅 openSessionIds 中、且仍存在于 sessions 的会话；保证当前会话一定在
  const ids = openSessionIds.includes(activeId) ? openSessionIds : [...openSessionIds, activeId]
  const tabSessions = ids.map((id) => sessions.find((s) => s.id === id)).filter((s): s is SessionDTO => !!s)
  const canClose = tabSessions.length > 1
  // 调试模式：活动会话的 resumableId
  const activeSession = sessions.find((s) => s.id === activeId)
  // 已完成会话数（用于 hist-count 徽章，对照原型 app.js refreshBadge L352-364）
  const doneCount = sessions.filter(
    (s) => s.status === 'completed' && s.id !== activeId
  ).length
  // 有运行中时显示红点（activeRunning 即当前会话运行中）
  const hasRunning = activeRunning

  // wirePopover 式：点外部关闭弹窗
  useEffect(() => {
    if (!histOpen) return
    const handler = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setHistOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [histOpen])

  return (
    <div className="chat-header">
      {/* 会话 tab 条（Issue 23）：每个已打开会话一个 tab，点切换、× 仅关 tab，溢出横向滚动 */}
      <div className="sess-tabs">
        {tabSessions.map((s) => {
          const active = s.id === activeId
          const running = active && activeRunning
          return (
            <button
              key={s.id}
              className={`sess-tab${active ? ' is-active' : ''}`}
              title={s.title}
              onClick={() => { if (!active) onSelect(s.id) }}
            >
              <span className={`st-dot ${s.engine}`} style={{ background: `var(--${s.engine})` }} />
              <span className="st-title">{s.title}</span>
              {running && <span className="st-run" title="运行中" />}
              {canClose && (
                <span
                  className="st-x"
                  title="关闭标签（不删除会话）"
                  onClick={(e) => { e.stopPropagation(); onCloseTab(s.id) }}
                >×</span>
              )}
            </button>
          )
        })}
      </div>

      {/* 调试模式：proj / sess / sdk / version 标识行 */}
      {debugMode && (
        <span className="dbg-head">
          🐞 proj {projectId?.slice(0, 8) ?? '—'} · sess {activeId?.slice(0, 8) ?? '—'} · sdk {activeSession?.resumableId?.slice(0, 8) ?? '—'}{activeSession?.claudeCodeVersion ? ` · v${activeSession.claudeCodeVersion}${activeSession.sdkVersion ? ` (sdk ${activeSession.sdkVersion})` : ''}` : ''}
        </span>
      )}

      {/* inline-switcher：历史按钮 + 弹窗 */}
      <div className="inline-switcher">
        <span className="chat-hist-wrap" ref={wrapRef}>
          <span className="hist-count" id="histCount" title="已完成的会话数">
            {doneCount}
          </span>
          <button
            className="chat-hicon"
            id="chatHistBtn"
            title="历史会话"
            aria-expanded={histOpen}
            onClick={() => setHistOpen((v) => !v)}
          >
            <IconHistory />
          </button>
          <span
            className="hist-running"
            id="histRunning"
            title="有会话进行中"
            hidden={!hasRunning}
          />
          {histOpen && (
            <SessionHistory
              sessions={sessions}
              activeId={activeId}
              activeRunning={activeRunning}
              onSelect={(id) => { onSelect(id); setHistOpen(false) }}
              onResume={onResume}
              onPin={onPin}
              onRename={onRename}
              onDelete={onDelete}
            />
          )}
        </span>
      </div>

      {/* 新会话按钮（在 inline-switcher 外，对照原型 L47）*/}
      <button className="chat-hicon" title="新会话" onClick={onNew}>
        <IconPlus />
      </button>
    </div>
  )
}
