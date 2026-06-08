/**
 * ProjBar.tsx — workspace 顶部条
 *
 * DOM 结构 1:1 对照 prototype/原型开发版/workspace.html .proj-bar（L15-20）：
 *   .proj-bar > [.chat-hicon 返回] + .title[.engdot + .proj-name] + .spacer + <RuntimeSwitcher/>
 *
 * 项目名重命名逻辑移植自 prototype/app.js L559-584（就地编辑 IIFE）
 * 确认后调 api.renameProject(projectId, 新名)，Esc/空值取消
 */

import React, { useState, useRef, useEffect } from 'react'
import { IconChevronLeft, IconMore } from '../ui/icons'
import { api } from '../api/client'
import { RuntimeSwitcher } from './RuntimeSwitcher'
import { useReminders } from '../hooks/useReminders'
import { RemindersModal } from './RemindersModal'
import { AGENT_LABEL } from './runtimeState'
import type { Engine } from '../api/types'

interface ProjBarProps {
  projectId: string
  projectName: string
  engine: 'claude' | 'codex'
  sessionId?: string                  // 传给 RuntimeSwitcher 拉动态模型列表（Issue 12）
  onBack: () => void
  onRename?: (name: string) => void   // 改名成功后回传新名 → 上层（AppNav）同步 projects/页签标题
  onAgentSwitch?: (engine: Engine) => void  // D5：代理段切换走会话区分流（透传给 RuntimeSwitcher）
  selectedAgent?: Engine | null       // D5 视觉标记：项目下个新会话用的引擎（与 engine 不同时显示提示）
}

export function ProjBar({ projectId, projectName, engine, sessionId, onBack, onRename, onAgentSwitch, selectedAgent }: ProjBarProps) {
  // 不再持有本地 displayName 副本：标题直接渲染 projectName（其值由上层 AppNav 按 id 现查 projects，
  // 与顶部页签同源）。曾经的本地副本一旦编辑就永不回退，会在 projects 被旧 reload 覆盖时造成
  // 「标题新名、页签旧名」的 split-brain；去掉它，标题与页签即恒等。编辑期间只用临时 draft。
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const doneRef = useRef(false)

  // 提醒：红点 = config.enabled；⋯ 菜单 + 配置模态
  const { config: rmdConfig, reload: rmdReload } = useReminders(projectId)
  const [menuOpen, setMenuOpen] = useState(false)
  const [modalOpen, setModalOpen] = useState(false)
  const rmdWrapRef = useRef<HTMLDivElement>(null)

  // 点外部 / Esc 关闭 ⋯ 菜单
  useEffect(() => {
    if (!menuOpen) return
    const onDown = (e: MouseEvent) => {
      if (rmdWrapRef.current && !rmdWrapRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenuOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [menuOpen])

  const startEdit = () => {
    if (editing) return
    setEditing(true)
    setDraft(projectName)
    doneRef.current = false
  }

  // commit(keep): keep=true → 保存新名，keep=false → 取消
  const commit = (keep: boolean, currentDraft: string) => {
    if (doneRef.current) return
    doneRef.current = true
    const trimmed = currentDraft.trim()
    setEditing(false)
    if (keep && trimmed && trimmed !== projectName) {
      onRename?.(trimmed)   // 回传上层乐观更新 projects → 项目标题 + 顶部页签同源刷新
      api.renameProject(projectId, trimmed).catch(() => {
        // 静默失败（前端 UI 层不处理后端错误）
      })
    }
  }

  return (
    <div className="proj-bar">
      {/* 返回按钮（path 1:1 from workspace.html L16） */}
      <a className="chat-hicon" title="返回首页" onClick={(e) => { e.preventDefault(); onBack() }} href="#">
        <IconChevronLeft size={16} />
      </a>

      {/* 标题区：engdot + 项目名（点击就地重命名） */}
      <div className="title">
        {/* engdot 反映当前会话引擎色（claude 橙 / codex 蓝），inline style 覆盖 base.css 写死的 var(--claude)，与 Chrome 项目标签 dot 一致 */}
        <span className="engdot" style={{ background: `var(--${engine})` }} />
        {editing ? (
          <input
            className="proj-rename"
            value={draft}
            autoFocus
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commit(true, draft) }
              else if (e.key === 'Escape') { e.preventDefault(); commit(false, draft) }
            }}
            onBlur={() => commit(true, draft)}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span
            className="proj-name"
            id="projName"
            title="点击重命名项目"
            onClick={startEdit}
          >
            {projectName}
          </span>
        )}
      </div>

      <div className="spacer" />

      {/* D5 视觉标记：项目 selectedAgent 与当前会话 engine 不同时，提示下个新会话用哪个引擎 */}
      {selectedAgent && selectedAgent !== engine && (
        <span className="proj-next-agent" title={`下个新会话用 ${AGENT_LABEL[selectedAgent] ?? selectedAgent}`}>
          <span className="pna-dot" style={{ background: `var(--${selectedAgent})` }} />
          下个新会话用 {AGENT_LABEL[selectedAgent] ?? selectedAgent}
        </span>
      )}

      {/* Runtime 切换器（消费 RuntimeContext，必须在 Provider 内使用） */}
      <RuntimeSwitcher sessionId={sessionId} onAgentSwitch={onAgentSwitch} />

      {/* 项目菜单·入口：运行时胶囊右侧「⋯」（最右端）。提醒已启用 → 带小红点。
          1:1 from workspace.html L21-29（.rmd-wrap > #rmdBtn + #rmdProjMenu） */}
      <div className="rmd-wrap" ref={rmdWrapRef}>
        <button
          className={`chat-hicon rmd-btn${rmdConfig.enabled ? ' is-on' : ''}`}
          id="rmdBtn"
          title="项目菜单"
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          type="button"
          onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
        >
          <IconMore size={16} />
          <span className="rmd-dot" />
        </button>
        <div className={`menu rmd-proj-menu${menuOpen ? ' open' : ''}`} id="rmdProjMenu">
          <button
            className="menu-item"
            type="button"
            data-rmd-open
            onClick={() => { setMenuOpen(false); setModalOpen(true) }}
          >
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
            项目提醒设置
          </button>
        </div>
      </div>

      <RemindersModal
        projectId={projectId}
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        config={rmdConfig}
        reload={rmdReload}
      />
    </div>
  )
}
