/**
 * ProjBar.tsx — workspace 顶部条
 *
 * DOM 结构 1:1 对照 prototype/原型开发版/workspace.html .proj-bar（L15-20）：
 *   .proj-bar > [.chat-hicon 返回] + .title[.engdot + .proj-name] + .spacer + <RuntimeSwitcher/>
 *
 * 项目名重命名逻辑移植自 prototype/app.js L559-584（就地编辑 IIFE）
 * 确认后调 api.renameProject(projectId, 新名)，Esc/空值取消
 */

import React, { useState, useRef } from 'react'
import { IconChevronLeft } from '../ui/icons'
import { api } from '../api/client'
import { RuntimeSwitcher } from './RuntimeSwitcher'

interface ProjBarProps {
  projectId: string
  projectName: string
  engine: 'claude' | 'codex'
  sessionId?: string                  // 传给 RuntimeSwitcher 拉动态模型列表（Issue 12）
  onBack: () => void
  onRename?: (name: string) => void   // 改名成功后回传新名 → 上层（AppNav）同步 projects/页签标题
}

export function ProjBar({ projectId, projectName, engine, sessionId, onBack, onRename }: ProjBarProps) {
  // 不再持有本地 displayName 副本：标题直接渲染 projectName（其值由上层 AppNav 按 id 现查 projects，
  // 与顶部页签同源）。曾经的本地副本一旦编辑就永不回退，会在 projects 被旧 reload 覆盖时造成
  // 「标题新名、页签旧名」的 split-brain；去掉它，标题与页签即恒等。编辑期间只用临时 draft。
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const doneRef = useRef(false)

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

      {/* Runtime 切换器（消费 RuntimeContext，必须在 Provider 内使用） */}
      <RuntimeSwitcher sessionId={sessionId} />
    </div>
  )
}
