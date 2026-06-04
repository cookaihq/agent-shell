/**
 * SessionHistory.tsx — 历史会话弹窗
 *
 * DOM 结构 1:1 对照原型 workspace.html L33-45（.hist-menu > .hist-search + .hist-scroll）
 * 交互逻辑移植自 prototype/app.js L348-449 历史 IIFE：
 *   refreshBadge、togglePin、startRename、ensureResumeActions
 *
 * 五态映射（去「等待确认」，A1 砍掉）：
 *   当前活动会话运行中 → 运行中 (.hi-when.run)
 *   否则 DB status：
 *     completed → 已完成（无额外 class）
 *     failed    → 失败  (.hi-when.fail)
 *     aborted   → 已中止(.hi-when.abort)
 *     idle      → 未开始（无额外 class）
 *
 * failed/aborted 项显示「继续」按钮 → onResume(id)
 * pin → onPin(id, !pinned)（调用方 PATCH pinned）
 * 重命名 → onRename(id, title)（调用方 PATCH title）
 * 搜索框前端过滤标题
 * 不渲染权限审批卡
 */

import { useState } from 'react'
import type { SessionDTO } from '../api/types'

// ── SVG 图标（inline，1:1 from workspace.html hi-actions）─────────────────────

const IconPin = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 4h6v6.5l2 2.5H7l2-2.5z" />
    <path d="M12 13.5V20" />
  </svg>
)

const IconEdit = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" />
    <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
)

const IconResume = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor" stroke="none">
    <path d="M7 5v14l12-7z" />
  </svg>
)

const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18" />
    <path d="M8 6V4h8v2" />
    <path d="M19 6l-1 14H6L5 6" />
    <path d="M10 11v6M14 11v6" />
  </svg>
)

// ── 单项 ──────────────────────────────────────────────────────────────────────

interface HistItemProps {
  session: SessionDTO
  isActive: boolean
  activeRunning: boolean
  onSelect: (id: string) => void
  onResume: (id: string) => void
  onPin: (id: string, pinned: boolean) => void
  onRename: (id: string, title: string) => void
  /** 真删除会话（连同对话历史，不可恢复）；与 tab 的「关闭」不同。 */
  onDelete: (id: string) => void
}

function HistItem({ session, isActive, activeRunning, onSelect, onResume, onPin, onRename, onDelete }: HistItemProps) {
  const [renaming, setRenaming] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [draft, setDraft] = useState('')
  const [doneRef] = useState({ current: false })

  // 状态计算（五态，去「等待确认」）
  let whenCls = ''
  let whenText = ''
  if (isActive && activeRunning) {
    whenCls = 'run'
    whenText = '运行中'
  } else {
    switch (session.status) {
      case 'completed': whenCls = '';      whenText = '已完成'; break
      case 'failed':    whenCls = 'fail';  whenText = '失败';   break
      case 'aborted':   whenCls = 'abort'; whenText = '已中止'; break
      case 'idle':      whenCls = '';      whenText = '未开始'; break
      default:          whenCls = '';      whenText = session.status
    }
  }

  // 是否可继续（failed / aborted）
  const isResumable = !isActive && (session.status === 'failed' || session.status === 'aborted')

  // 重命名：就地 input → onRename(id, title)（移植 app.js startRename L399-421）
  const startRename = (e: React.MouseEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setDraft(session.title)
    doneRef.current = false
    setRenaming(true)
  }

  const commitRename = (keep: boolean, currentDraft: string) => {
    if (doneRef.current) return
    doneRef.current = true
    const trimmed = currentDraft.trim()
    if (keep && trimmed && trimmed !== session.title) {
      onRename(session.id, trimmed)
    }
    setRenaming(false)
  }

  // 删除二次确认：点垃圾桶 → 整行替换为确认条，确认才真删（删了对话历史不可恢复）
  if (confirming) {
    return (
      <div className="hist-item is-confirming">
        <span className="hi-confirm-text">删除「{session.title}」？此操作不可恢复</span>
        <span className="hi-confirm-actions">
          <button
            className="hi-confirm-btn del"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDelete(session.id) }}
          >删除</button>
          <button
            className="hi-confirm-btn"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(false) }}
          >取消</button>
        </span>
      </div>
    )
  }

  return (
    <div
      className={`hist-item${isActive ? ' is-active' : ''}${session.pinned ? ' is-pinned' : ''}`}
    >
      <span className={`hi-dot ${session.engine}`} />

      <span className="hi-body">
        {renaming ? (
          <input
            className="hi-rename"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(true, draft) }
              else if (e.key === 'Escape') { e.preventDefault(); commitRename(false, draft) }
            }}
            onBlur={() => commitRename(true, draft)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="hi-title" onClick={() => onSelect(session.id)}>
            {session.title}
          </span>
        )}
      </span>

      <span className={`hi-when${whenCls ? ' ' + whenCls : ''}`}>{whenText}</span>

      <span className="hi-actions">
        {/* 继续按钮：failed / aborted 项显示（移植 ensureResumeActions L427-438）*/}
        {isResumable && (
          <button
            className="hi-act"
            data-act="resume"
            title="继续会话"
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onResume(session.id) }}
          >
            <IconResume />
          </button>
        )}
        {/* 置顶按钮（移植 togglePin）*/}
        <button
          className="hi-act"
          data-act="pin"
          title={session.pinned ? '取消固定' : '固定到顶部'}
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); onPin(session.id, !session.pinned) }}
        >
          <IconPin />
        </button>
        {/* 重命名按钮（移植 startRename）*/}
        <button
          className="hi-act"
          data-act="edit"
          title="重命名"
          onClick={startRename}
        >
          <IconEdit />
        </button>
        {/* 删除按钮：真删除会话（连同对话历史）→ 进二次确认。区别于 tab 的「关闭」（仅隐藏 tab）。 */}
        <button
          className="hi-act"
          data-act="delete"
          title="删除会话"
          onClick={(e) => { e.preventDefault(); e.stopPropagation(); setConfirming(true) }}
        >
          <IconTrash />
        </button>
      </span>
    </div>
  )
}

// ── SessionHistory ────────────────────────────────────────────────────────────

interface SessionHistoryProps {
  sessions: SessionDTO[]
  activeId: string
  activeRunning: boolean
  onSelect: (id: string) => void
  onResume: (id: string) => void
  onPin: (id: string, pinned: boolean) => void
  onRename: (id: string, title: string) => void
  /** 真删除会话（连同对话历史，不可恢复） */
  onDelete: (id: string) => void
}

export function SessionHistory({
  sessions,
  activeId,
  activeRunning,
  onSelect,
  onResume,
  onPin,
  onRename,
  onDelete,
}: SessionHistoryProps) {
  const [query, setQuery] = useState('')

  // 前端过滤（搜索标题）
  const filtered = query.trim()
    ? sessions.filter((s) => s.title.includes(query.trim()))
    : sessions

    // .menu 基类是 display:none，靠 .open 显示（原型 wirePopover 范式）；React 这里条件挂载即「已打开」，必须带 open
  return (
    <div className="menu hist-menu open" id="chatHistPop">
      {/* 搜索框（L34）*/}
      <div className="hist-search">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
          <circle cx="11" cy="11" r="7" />
          <path d="M21 21l-4-4" />
        </svg>
        <input
          placeholder="搜索本项目会话…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {/* 会话列表（L35-44）*/}
      <div className="hist-scroll">
        {filtered.length === 0 ? (
          <div className="hist-empty">{query.trim() ? '没有匹配的会话' : '暂无会话'}</div>
        ) : filtered.map((s) => (
          <HistItem
            key={s.id}
            session={s}
            isActive={s.id === activeId}
            activeRunning={activeRunning}
            onSelect={onSelect}
            onResume={onResume}
            onPin={onPin}
            onRename={onRename}
            onDelete={onDelete}
          />
        ))}
      </div>
    </div>
  )
}
