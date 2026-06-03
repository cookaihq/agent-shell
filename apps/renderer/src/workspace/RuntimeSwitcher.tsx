/**
 * RuntimeSwitcher.tsx — proj-bar 右上角的运行时切换器
 *
 * DOM 结构 1:1 对照 prototype/原型开发版/app.js renderSwitcher L58-83
 * 弹窗开合逻辑移植自 wirePopover L315-325 + 外部点击关闭 L328-333
 * 切换 dispatch 移植自 chip 内部交互 L336-345
 *
 * M7a：切换只改前端状态，不调任何后端 api。
 */

import React, { useEffect, useRef, useState } from 'react'
import { useRuntime, CLI_MODELS, AGENT_LABEL } from './runtimeState'
import { EngIcon } from '../ui/icons'
import { useSettings } from '../settings/SettingsContext'

// 代理 icon 背景色（对应原型 AGENT_ICON_BG）
const AGENT_ICON_BG: Record<string, string> = {
  claude: 'var(--accent)',
  codex: 'var(--blue)',
}

export function RuntimeSwitcher() {
  const { runtime, dispatch } = useRuntime()
  const { openSettings } = useSettings()
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 点外部关闭（移植 wirePopover 外部 click + L328-333）
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (!wrapRef.current?.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('click', handler)
    return () => document.removeEventListener('click', handler)
  }, [])

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(prev => !prev)
  }

  const modelList = CLI_MODELS[runtime.agent] ?? []

  return (
    <div className="inline-switcher" ref={wrapRef}>
      {/* isw-chip：点击开合弹窗 */}
      <button
        className="isw-chip"
        id="iswChip"
        aria-expanded={open ? 'true' : 'false'}
        onClick={toggleOpen}
      >
        <span
          className="isw-icon"
          style={{ background: AGENT_ICON_BG[runtime.agent] ?? 'var(--accent)' }}
        >
          {/* 引擎内嵌小 SVG（和原型 renderSwitcher L62 一致） */}
          {runtime.agent === 'claude' ? (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M8 10l3.5 4L8 18" />
              <path d="M14 18h4" />
            </svg>
          ) : (
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <circle cx="12" cy="12" r="7" />
              <path d="M12 8v8M8 12h8" strokeLinecap="round" />
            </svg>
          )}
        </span>
        <span className="isw-text">
          <span className="isw-mode" id="chipMode">本地 CLI</span>
          <span className="isw-sep">·</span>
          <span className="isw-primary" id="chipPrimary">{AGENT_LABEL[runtime.agent] ?? runtime.agent}</span>
          <span className="isw-sep">·</span>
          <span className="isw-model" id="chipModel">{runtime.model}</span>
        </span>
        <span className="isw-chev">⌄</span>
      </button>

      {/* isw-pop：弹窗内容（对照 renderSwitcher L66-82） */}
      <div className={`isw-pop${open ? ' open' : ''}`} id="iswPop">
        <div className="isw-mode-cli">
          {/* 代理选择（agent grid） */}
          <div className="isw-row">
            <span className="isw-label">代理</span>
            <div className="isw-agent-grid">
              <button
                className={`isw-agent${runtime.agent === 'claude' ? ' is-active' : ''}`}
                data-agent="claude"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'SET_AGENT', agent: 'claude' })
                }}
              >
                <EngIcon engine="claude" />
                <span className="ag-nm">Claude Code</span>
              </button>
              <button
                className={`isw-agent${runtime.agent === 'codex' ? ' is-active' : ''}`}
                data-agent="codex"
                onClick={(e) => {
                  e.stopPropagation()
                  dispatch({ type: 'SET_AGENT', agent: 'codex' })
                }}
              >
                <EngIcon engine="codex" />
                <span className="ag-nm">Codex CLI</span>
              </button>
            </div>
          </div>

          {/* 模型 select */}
          <div className="isw-row">
            <span className="isw-label">模型</span>
            <select
              className="isw-select"
              id="iswModelCli"
              value={runtime.model}
              onChange={(e) => {
                e.stopPropagation()
                dispatch({ type: 'SET_MODEL', model: e.target.value })
              }}
            >
              {modelList.map(m => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 打开执行设置 */}
        <button className="isw-more" onClick={() => { setOpen(false); openSettings('exec') }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19 13a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.8 1V21a2 2 0 1 1-4 0 1.6 1.6 0 0 0-2.8-1 2 2 0 1 1-2.8-2.8A1.6 1.6 0 0 0 5 13a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.4-2.5A2 2 0 1 1 9.2 3.7 1.6 1.6 0 0 0 11 4a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.8-.3 2 2 0 1 1 2.8 2.8A1.6 1.6 0 0 0 21 9a2 2 0 1 1 0 4z" />
          </svg>
          {' '}打开执行设置
        </button>
      </div>
    </div>
  )
}
