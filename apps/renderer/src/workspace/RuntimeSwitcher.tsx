/**
 * RuntimeSwitcher.tsx — proj-bar 右上角的运行时切换器（外壳件，零 Agent 分支）
 *
 * 代理网格固定列「本机 CLI」两个引擎（claude/codex），点切 SET_AGENT；
 * 模型下拉用当前引擎切片 chatUIConfig.getModelOptions（动态优先），展示名走 getModelLabel。
 * 引擎图标走切片无关的 EngIcon（按 engine 取图）。
 *
 * 切换只改前端状态，不调任何后端 api（动态模型列表除外）。
 */

import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { useRuntime, AGENT_LABEL, slotsOf } from './runtimeState'
import { SLICES } from './agents/registry'
import type { Engine } from '../api/types'
import type { DynModel } from './ModelPill'
import { EngIcon } from '../ui/icons'
import { useSettings } from '../settings/SettingsContext'

// 代理 icon 背景色（按 engine 取；中立映射，非分支逻辑）
const AGENT_ICON_BG: Record<string, string> = {
  claude: 'var(--accent)',
  codex: 'var(--blue)',
}

// 代理网格列：枚举已注册切片（SLICES），名取 AGENT_LABEL——不硬编码引擎清单。
const AGENTS: { engine: Engine; name: string }[] = (Object.keys(SLICES) as Engine[]).map((engine) => ({
  engine,
  name: AGENT_LABEL[engine] ?? engine,
}))

export function RuntimeSwitcher({ sessionId }: { sessionId?: string } = {}) {
  const { runtime, dispatch } = useRuntime()
  const { openSettings } = useSettings()
  const [open, setOpen] = useState(false)
  // 动态模型列表：来自活动会话 supportedModels；null=无活会话 → 回落静态（Issue 12）
  const [dynModels, setDynModels] = useState<DynModel[] | null>(null)
  const wrapRef = useRef<HTMLDivElement>(null)

  const ui = SLICES[runtime.engine].chatUIConfig

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

  // 打开弹窗时拉一次 supportedModels（仅支持动态的切片有活动会话）
  useEffect(() => {
    if (!open || !sessionId || !ui.supportsDynamicModels) return
    let off = false
    api.models(sessionId).then((r) => { if (!off) setDynModels(r.models) }).catch(() => {})
    return () => { off = true }
  }, [open, sessionId, ui.supportsDynamicModels])

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(prev => !prev)
  }

  const dyn = dynModels ? dynModels.map((m) => ({ value: m.value, label: m.displayName, description: m.description })) : null
  const modelList = ui.getModelOptions(slotsOf(runtime), dyn)

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
          style={{ background: AGENT_ICON_BG[runtime.engine] ?? 'var(--accent)' }}
        >
          <EngIcon engine={runtime.engine} />
        </span>
        <span className="isw-text">
          <span className="isw-mode" id="chipMode">本地 CLI</span>
          <span className="isw-sep">·</span>
          <span className="isw-primary" id="chipPrimary">{AGENT_LABEL[runtime.engine] ?? runtime.engine}</span>
          <span className="isw-sep">·</span>
          <span className="isw-model" id="chipModel">{ui.getModelLabel(runtime.model, dyn)}</span>
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
              {AGENTS.map((a) => (
                <button
                  key={a.engine}
                  className={`isw-agent${runtime.engine === a.engine ? ' is-active' : ''}`}
                  data-agent={a.engine}
                  onClick={(e) => {
                    e.stopPropagation()
                    dispatch({ type: 'SET_AGENT', agent: a.engine })
                  }}
                >
                  <EngIcon engine={a.engine} />
                  <span className="ag-nm">{a.name}</span>
                </button>
              ))}
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
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
        </div>

        {/* 打开执行设置 */}
        <button className="isw-more" onClick={() => { setOpen(false); openSettings('exec') }}>
          <svg viewBox="0 0 24 24" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
          </svg>
          {' '}打开执行设置
        </button>
      </div>
    </div>
  )
}
