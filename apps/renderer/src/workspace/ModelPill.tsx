/**
 * ModelPill.tsx — Task 16
 *
 * 模型胶囊 + model-pop 弹窗
 * 高保真对照 app.js renderModelPop(L177-208) + model-btn IIFE(L603-628)
 *
 * 消费 RuntimeContext（useRuntime），只改前端状态，不调任何后端 api。
 *
 * 脸：.model-btn > .mb-text > .model-name + .mb-extra
 *   mb-extra：chipPerm → .mb-dot(背景色) + .mb-tag(text) + chipEffort → .mb-tag(effort)
 *             中间 .mb-sep「·」
 *
 * 弹窗 .model-pop（点 model-btn 开合、点外部关）：
 *   claude → 权限段(CLAUDE_MODES) + Effort段 + 模型段
 *   codex  → 审批策略段(CODEX_APPROVAL) + 沙箱级别段(CODEX_SANDBOX) + Effort段 + 模型段
 */

import { useState, useEffect, useRef } from 'react'
import { api } from '../api/client'
import {
  useRuntime,
  chipPerm,
  chipEffort,
  RISK_COLOR,
  CLAUDE_MODES,
  CODEX_APPROVAL,
  CODEX_SANDBOX,
  EFFORTS,
  CLI_MODELS,
  AGENT_LABEL,
  modelLabel,
  type ClaudeMode,
  type CodexApproval,
  type CodexSandbox,
} from './runtimeState'
import type { Engine } from '../api/types'

/** 动态模型项（来自 daemon supportedModels）：value=API id（发给 daemon），displayName=展示名，description=副标题（能力描述，含 1M 等）。 */
export interface DynModel { value: string; displayName: string; description?: string }

export function ModelPill({ sessionId }: { sessionId?: string } = {}) {
  const { runtime, dispatch } = useRuntime()
  const [open, setOpen] = useState(false)
  // 动态模型列表（claude）：打开弹窗时拉一次活动会话的 supportedModels；null=无活会话 → 回落静态 CLI_MODELS
  const [dynModels, setDynModels] = useState<DynModel[] | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open || !sessionId || runtime.agent !== 'claude') return
    let off = false
    api.models(sessionId).then((r) => { if (!off) setDynModels(r.models) }).catch(() => {})
    return () => { off = true }
  }, [open, sessionId, runtime.agent])

  // 点外部关弹窗（移植 model-btn IIFE L626）
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      if (
        popRef.current &&
        !popRef.current.contains(target) &&
        btnRef.current &&
        !btnRef.current.contains(target)
      ) {
        setOpen(false)
      }
    }
    const keyHandler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    document.addEventListener('keydown', keyHandler)
    return () => {
      document.removeEventListener('mousedown', handler)
      document.removeEventListener('keydown', keyHandler)
    }
  }, [open])

  const perm = chipPerm(runtime)
  const effort = chipEffort(runtime)

  return (
    <>
      <button
        ref={btnRef}
        className={`model-btn${open ? ' is-open' : ''}`}
        type="button"
        aria-label={runtime.model}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <span className="mb-text">
          <span className="model-name">{modelLabel(runtime.agent, runtime.model, dynModels)}</span>
          <span className="mb-extra">
            {perm && (
              <>
                <span className="mb-sep">·</span>
                <span className="mb-dot" style={{ background: RISK_COLOR[perm.risk] }} />
                <span className="mb-tag">{perm.text}</span>
              </>
            )}
            {effort && (
              <>
                <span className="mb-sep">·</span>
                <span className="mb-tag">{effort}</span>
              </>
            )}
          </span>
        </span>
      </button>

      {/* model-pop 弹窗 */}
      {open && (
        <div className="model-pop" ref={popRef}>
          <ModelPopContent
            runtime={runtime}
            dispatch={dispatch}
            dynModels={dynModels}
            onClose={() => setOpen(false)}
          />
        </div>
      )}
    </>
  )
}

// ── 弹窗内容（移植 renderModelPop L177-208）───────────────────────────────────

interface ModelPopContentProps {
  runtime: ReturnType<typeof useRuntime>['runtime']
  dispatch: ReturnType<typeof useRuntime>['dispatch']
  dynModels?: DynModel[] | null
  onClose: () => void
}

function ModelPopContent({ runtime, dispatch, dynModels, onClose }: ModelPopContentProps) {
  const agent = runtime.agent
  const efforts = EFFORTS[agent] ?? []
  const curEffortId = runtime.effort[agent]
  const curEffort = efforts.find((l) => l.id === curEffortId) ?? efforts[0]
  // claude 有活动会话的动态模型 → 用 {value,displayName}；否则回落静态展示名列表
  const dynamic = agent === 'claude' && dynModels && dynModels.length > 0 ? dynModels : null
  // claude 活动会话用 SDK supportedModels（value/displayName/description，含 1M 变体）；否则回落静态表
  const modelList: { value: string; label: string; description?: string }[] = dynamic
    ? dynamic.map((m) => ({ value: m.value, label: m.displayName, description: m.description }))
    : (CLI_MODELS[agent] ?? [])
  const groupLabel = (AGENT_LABEL[agent] ?? agent) + (dynamic ? ' · 动态' : '')

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement

    // effort dot（app.js L616）
    const dot = target.closest('[data-effort]') as HTMLElement | null
    if (dot) {
      const effortId = dot.getAttribute('data-effort')!
      dispatch({ type: 'SET_EFFORT', agent: agent as Engine, effortId })
      return
    }

    // model-item 或 opt-item（app.js L617-624）
    const item = target.closest('.model-item, .opt-item') as HTMLElement | null
    if (!item) return

    if (item.hasAttribute('data-cmode')) {
      dispatch({ type: 'SET_CLAUDE_MODE', claudeMode: item.getAttribute('data-cmode')! as ClaudeMode })
      return
    }
    if (item.hasAttribute('data-capproval')) {
      dispatch({ type: 'SET_CODEX_APPROVAL', codexApproval: item.getAttribute('data-capproval')! as CodexApproval })
      return
    }
    if (item.hasAttribute('data-csandbox')) {
      dispatch({ type: 'SET_CODEX_SANDBOX', codexSandbox: item.getAttribute('data-csandbox')! as CodexSandbox })
      return
    }
    if (item.hasAttribute('data-model')) {
      dispatch({ type: 'SET_MODEL', model: item.getAttribute('data-model')! })
      onClose()
      return
    }
  }

  return (
    <div onClick={handleClick}>
      {/* claude 权限段（5 档原生 permissionMode，接 SDK 真链路）；codex 审批策略+沙箱段 */}
      {agent === 'claude' && (
        <div className="model-group">
          <div className="model-group-h">权限</div>
          {CLAUDE_MODES.map((m) => (
            <OptRow
              key={m.id}
              active={m.id === runtime.claudeMode}
              dataAttr="data-cmode"
              dataVal={m.id}
              zh={m.zh}
              en={m.en}
            />
          ))}
        </div>
      )}
      {agent === 'codex' && (
        <>
          <div className="model-group">
            <div className="model-group-h">审批策略</div>
            {CODEX_APPROVAL.map((m) => (
              <OptRow
                key={m.id}
                active={m.id === runtime.codexApproval}
                dataAttr="data-capproval"
                dataVal={m.id}
                zh={m.zh}
                en={m.en}
              />
            ))}
          </div>
          <div className="model-group">
            <div className="model-group-h">沙箱级别</div>
            {CODEX_SANDBOX.map((m) => (
              <OptRow
                key={m.id}
                active={m.id === runtime.codexSandbox}
                dataAttr="data-csandbox"
                dataVal={m.id}
                zh={m.zh}
                en={m.en}
              />
            ))}
          </div>
        </>
      )}

      {/* Effort 点滑条段 (app.js L192-201) */}
      {efforts.length > 0 && (
        <div className="model-group">
          <div className="effort-row">
            <span className="effort-cap">
              思考强度<i>Effort · {curEffort?.en}</i>
            </span>
            <span className="effort-dots">
              {efforts.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  className={`effort-dot${l.id === curEffortId ? ' is-active' : ''}${i === efforts.length - 1 ? ' is-extreme' : ''}`}
                  data-effort={l.id}
                  title={l.en}
                />
              ))}
            </span>
          </div>
        </div>
      )}

      {/* 模型段 — 对齐 Claude Code 原生 Select a model：displayName 标题 + description 副标题 + 选中打勾高亮 */}
      <div className="model-group">
        <div className="model-group-h">{groupLabel}</div>
        {modelList.map((m) => (
          <button
            key={m.value}
            type="button"
            className={`model-item${m.description ? ' model-item-2l' : ''}${m.value === runtime.model ? ' is-active' : ''}`}
            data-model={m.value}
          >
            <span className="mi-text">
              <span className="mi-title">{m.label}</span>
              {m.description && <span className="mi-desc">{m.description}</span>}
            </span>
            <span className="mk">✓</span>
          </button>
        ))}
      </div>
    </div>
  )
}

// ── OptRow（移植 optRow 函数）────────────────────────────────────────────────

interface OptRowProps {
  active: boolean
  dataAttr: string
  dataVal: string
  zh: string
  en: string
}

function OptRow({ active, dataAttr, dataVal, zh, en }: OptRowProps) {
  // 用 button 而非 div，便于 userEvent.click
  const attrs: Record<string, string> = { [dataAttr]: dataVal }
  return (
    <button
      type="button"
      className={`model-item opt-item${active ? ' is-active' : ''}`}
      {...attrs}
    >
      <span className="opt-t"><b>{zh}</b><i>{en}</i></span>
      <span className="mk">✓</span>
    </button>
  )
}
