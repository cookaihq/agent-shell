/**
 * ModelPill.tsx — 模型胶囊 + model-pop 弹窗（外壳件，零 Agent 分支）
 *
 * 消费 RuntimeContext（useRuntime）+ 当前引擎切片 chatUIConfig，渲染切片返回的描述符：
 *   - 脸：getModelLabel + getRuntimeChips（dot+tag / tag）
 *   - 弹窗：getModeSelector（claude 权限 1 段 / codex 审批+沙箱 2 段）+ getEffortSection + getModelSection
 *
 * 只改前端状态（dispatch 中立 action），不调任何后端 api（动态模型列表除外）。
 */

import { useState, useEffect, useRef } from 'react'
import { createPortal } from 'react-dom'
import { api } from '../api/client'
import { useRuntime, RISK_COLOR, slotsOf } from './runtimeState'
import type { RuntimeState, RuntimeAction } from './runtimeState'
import { SLICES } from './agents/registry'
import type { UIModelOption, ModeSegment } from './agents/types'
import type { SlashCommand, Engine } from '../api/types'
import { SkillModal } from '../entry/SkillModal'
import { useActiveProviderModels } from './useActiveProviderModels'
import { resolveModelDisplay } from './modelDisplay'

// 右箭头（折叠行尾，点击呼出 flyout）。移植自原型 app.js CARET。
const CARET_SVG = (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 18l6-6-6-6" />
  </svg>
)

/** 动态模型项（来自 daemon supportedModels）：value=API id，displayName=展示名，description=副标题。 */
export interface DynModel { value: string; displayName: string; description?: string }

/** dynModels（{value,displayName}）→ 切片消费的 UIModelOption（{value,label}）。 */
function toUIModels(dyn: DynModel[] | null): UIModelOption[] | null {
  return dyn ? dyn.map((m) => ({ value: m.value, label: m.displayName, description: m.description })) : null
}

export function ModelPill({
  sessionId,
  commands,
  onInsertCommand,
  onOpenCommands,
  projectId,
}: {
  sessionId?: string
  /** 动态命令（claude，来自 SDK supportedCommands/commands_changed）。点行把 /name 填进输入框。 */
  commands?: SlashCommand[]
  onInsertCommand?: (name: string) => void
  /** 打开弹框时按需取命令（取数从 mount 一次性 → 打开时取）；仅支持动态命令的切片（claude）触发，不为 codex 探针。 */
  onOpenCommands?: () => void
  /** 当前已打开项目 id；有则「注入技能」完成后对该项目软链选中的技能。 */
  projectId?: string
} = {}) {
  const { runtime, dispatch } = useRuntime()
  const [open, setOpen] = useState(false)
  const [skillOpen, setSkillOpen] = useState(false)
  const [modelAliases, setModelAliases] = useState<Record<string, Record<string, string>>>({})
  useEffect(() => { api.getConfig().then((c) => setModelAliases(c.modelAliases ?? {})).catch(() => {}) }, [])
  const providerModels = useActiveProviderModels(runtime.engine, open)
  // 注入技能反馈 toast（复用 .proj-toast；自动消失）
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }
  useEffect(() => () => { if (toastTimer.current) clearTimeout(toastTimer.current) }, [])
  // 动态模型列表（支持动态的切片）：打开弹窗时拉一次活动会话的 supportedModels；null=无活会话 → 回落静态
  const [dynModels, setDynModels] = useState<DynModel[] | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const popRef = useRef<HTMLDivElement>(null)

  const slice = SLICES[runtime.engine]
  const ui = slice.chatUIConfig

  useEffect(() => {
    if (!open || !sessionId || !ui.supportsDynamicModels) return
    let off = false
    api.models(sessionId).then((r) => { if (!off) setDynModels(r.models) }).catch(() => {})
    return () => { off = true }
  }, [open, sessionId, ui.supportsDynamicModels])

  // 打开弹框时按需取命令（不在 mount 取）：仅 claude（supportsDynamicModels）触发，避免为 codex 起 claude 探针。
  // 取数与双入口（有 sessionId 走会话、无走项目）由 Composer 的 onOpenCommands 实现。
  useEffect(() => {
    if (open && ui.supportsDynamicModels) onOpenCommands?.()
  }, [open, ui.supportsDynamicModels, onOpenCommands])

  // 点外部关弹窗（移植 model-btn IIFE L626）
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      const target = e.target as Node
      // flyout 是 portal 到 body 的，逻辑上属于本弹窗：点它内部不算「外部」
      const inFlyout = (target as HTMLElement).closest?.('.model-flyout') != null
      if (
        !inFlyout &&
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

  const dyn = toUIModels(dynModels)
  const chips = ui.getRuntimeChips(slotsOf(runtime))

  // 脸 chip 当前模型别名显示（dynModels 优先，其次别名配置）
  const allModelOptions = ui.getModelOptions ? ui.getModelOptions(slotsOf(runtime), dyn, providerModels) : []
  const faceLabelFromOptions = allModelOptions.find((m) => m.value === runtime.model)?.label
  const faceDisplay = resolveModelDisplay(runtime.engine, runtime.model, {
    providerLabel: providerModels?.find((pm) => pm.value === runtime.model)?.label,
    officialLabel: faceLabelFromOptions,
    modelAliases,
  })

  return (
    <>
      <button
        ref={btnRef}
        className={`model-btn${open ? ' is-open' : ''}`}
        type="button"
        aria-label={faceDisplay.name}
        onClick={(e) => {
          e.stopPropagation()
          setOpen((v) => !v)
        }}
      >
        <span className="mb-text">
          <span className="model-name">{faceDisplay.name}</span>
          <span className="mb-extra">
            {chips.map((chip) => (
              <span key={chip.key} className="mb-chip-wrap">
                <span className="mb-sep">·</span>
                {chip.risk && <span className="mb-dot" style={{ background: RISK_COLOR[chip.risk] }} />}
                <span className="mb-tag">{chip.text}</span>
              </span>
            ))}
          </span>
        </span>
      </button>

      {/* model-pop 弹窗 */}
      {open && (
        <div className="model-pop" ref={popRef}>
          <ModelPopContent
            runtime={runtime}
            dispatch={dispatch}
            dynModels={dyn}
            providerModels={providerModels}
            modelAliases={modelAliases}
            commands={commands}
            onInsertCommand={onInsertCommand}
            onInjectSkill={() => { setOpen(false); setSkillOpen(true) }}
            onClose={() => setOpen(false)}
          />
        </div>
      )}

      {skillOpen && (
        <SkillModal
          initialSelected={[]}
          onClose={() => setSkillOpen(false)}
          onDone={(names) => {
            setSkillOpen(false)
            if (!projectId || names.length === 0) return
            api.injectSkills(projectId, names)
              .then(() => showToast('已注入技能到当前项目'))
              .catch(() => showToast('注入技能失败'))
          }}
        />
      )}

      {toast && <div className="proj-toast show">{toast}</div>}
    </>
  )
}

// ── 弹窗内容（渲染切片描述符）─────────────────────────────────────────────────

interface ModelPopContentProps {
  runtime: RuntimeState
  dispatch: React.Dispatch<RuntimeAction>
  dynModels?: UIModelOption[] | null
  providerModels?: UIModelOption[]
  modelAliases?: Record<string, Record<string, string>>
  commands?: SlashCommand[]
  onInsertCommand?: (name: string) => void
  onInjectSkill: () => void
  onClose: () => void
}

function ModelPopContent({ runtime, dispatch, dynModels, providerModels, modelAliases = {}, commands, onInsertCommand, onInjectSkill, onClose }: ModelPopContentProps) {
  const ui = SLICES[runtime.engine].chatUIConfig
  const slots = slotsOf(runtime)
  const modeSegments = ui.getModeSelector(slots)
  const effort = ui.getEffortSection?.(slots) ?? null
  const modelSection = ui.getModelSection(slots, dynModels, providerModels)
  // 命令区只对支持动态模型/命令的切片显示（claude）——slash commands 是 claude SDK 能力，由切片标志门控。
  const showCommands = !!ui.supportsDynamicModels

  // flyout 受控：null=关；DOMRect=已开（来自折叠行 getBoundingClientRect，供 fixed 定位）
  const [flyoutRect, setFlyoutRect] = useState<DOMRect | null>(null)

  // 顶部过滤框（对齐 VS Code 命令面板）：query 实时过滤全弹窗项；打开自动聚焦可直接打字
  const [query, setQuery] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])
  const q = query.trim().toLowerCase()
  const hasQuery = q !== ''
  const match = (s: string) => !hasQuery || s.toLowerCase().includes(q)
  // Esc 两段式：有内容先清空（拦截，不让外层 document 监听关弹窗）；为空才冒泡到外层关闭
  const onFilterKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Escape' && query) {
      e.preventDefault()
      e.stopPropagation()
      ;(e.nativeEvent as Event).stopImmediatePropagation?.()
      setQuery('')
    }
  }
  // 各区过滤结果（query 空 → 全显示）
  const filteredSegments = modeSegments
    .map((seg: ModeSegment) => ({ seg, options: seg.options.filter((o) => match(`${o.zh} ${o.en}`)) }))
    .filter((x) => x.options.length > 0)
  const effortVisible = !!effort && effort.options.length > 0 && match(`思考强度 effort ${effort.current?.en ?? ''}`)
  const modelGroupMatch = match(modelSection.groupLabel)
  const filteredModels = modelGroupMatch
    ? modelSection.list
    : modelSection.list.filter((m) => match(`${m.label} ${m.description ?? ''}`))
  const modelVisible = !hasQuery || filteredModels.length > 0
  const filteredCommands = (commands ?? []).filter((c) => match(`/${c.name} ${c.description ?? ''}`))
  const commandsVisible = showCommands && (!hasQuery || filteredCommands.length > 0)
  const nothingMatched = hasQuery && filteredSegments.length === 0 && !effortVisible && filteredModels.length === 0 && !commandsVisible

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement

    // 命令行 → 把 /name 填进输入框（不直接执行），优先处理避免被其它分支吞掉
    const cmd = target.closest('[data-cmd]') as HTMLElement | null
    if (cmd) {
      onInsertCommand?.(cmd.getAttribute('data-cmd')!)
      onClose()
      return
    }

    // 折叠行 → 开/关 flyout（再点收起）
    const toggle = target.closest('[data-model-toggle]') as HTMLElement | null
    if (toggle) {
      setFlyoutRect((cur) => (cur ? null : toggle.getBoundingClientRect()))
      return
    }
    // pop 内其它任意交互都先收起 flyout（对齐原型 closeFlyout()）
    if (flyoutRect) setFlyoutRect(null)

    // effort dot
    const dot = target.closest('[data-effort]') as HTMLElement | null
    if (dot) {
      dispatch({ type: 'SET_REASONING', reasoning: dot.getAttribute('data-effort')! })
      return
    }

    // mode 段选项（通用：data-mode-slot + data-mode-val）
    const item = target.closest('.model-item, .opt-item') as HTMLElement | null
    if (!item) return

    const slot = item.getAttribute('data-mode-slot')
    if (slot) {
      const value = item.getAttribute('data-mode-val')!
      if (slot === 'permissionMode') dispatch({ type: 'SET_PERMISSION_MODE', permissionMode: value })
      else dispatch({ type: 'SET_MODE_SELECTION', slot, value })
      return
    }
    if (item.hasAttribute('data-model')) {
      dispatch({ type: 'SET_MODEL', model: item.getAttribute('data-model')! })
      onClose()
      return
    }
  }

  return (
    <div className="model-pop-body" onClick={handleClick}>
      {/* 顶部过滤框（对齐 VS Code 命令面板）：固定在顶部，不随内容滚动 */}
      <div className="model-filter">
        <input
          ref={inputRef}
          className="model-filter-input"
          type="text"
          placeholder="Filter actions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={onFilterKeyDown}
        />
      </div>

      <div className="model-scroll">
      {/* 权限/审批/沙箱多段选择器（claude 1 段；codex 2 段）——切片决定段数/标题/选项/写哪个槽 */}
      {filteredSegments.map(({ seg, options }) => (
        <div className="model-group model-group-modes" key={seg.key}>
          <div className="model-group-h">{seg.title}</div>
          {options.map((o) => (
            <OptRow
              key={o.id}
              active={o.id === seg.current}
              slot={seg.slot}
              val={o.id}
              zh={o.zh}
              en={o.en}
            />
          ))}
        </div>
      ))}

      {/* Effort 点滑条段 */}
      {effortVisible && effort && (
        <div className="model-group">
          <div className="effort-row">
            <span className="effort-cap">
              思考强度<i>Effort · {effort.current?.en}</i>
            </span>
            <span className="effort-dots">
              {effort.options.map((l, i) => (
                <button
                  key={l.id}
                  type="button"
                  className={`effort-dot${l.id === effort.current?.id ? ' is-active' : ''}${i === effort.options.length - 1 ? ' is-extreme' : ''}`}
                  data-effort={l.id}
                  title={l.en}
                />
              ))}
            </span>
          </div>
        </div>
      )}

      {/* 模型段 — 折叠态（claude）：当前项 + 右箭头，点呼出 flyout；平铺态（codex）：列全部。过滤态平铺并过滤，能搜到非当前模型 */}
      {modelVisible && (
      <div className="model-group">
        <div className="model-group-h">{modelSection.groupLabel}</div>
        {modelSection.collapsed && !hasQuery ? (
          (() => {
            const cur = modelSection.current
            const cd = cur ? resolveModelDisplay(runtime.engine, cur.value, { providerLabel: providerModels?.find((pm) => pm.value === cur.value)?.label, officialLabel: cur.label, modelAliases }) : null
            return (
              <button
                type="button"
                className="model-item model-item-2l model-collapsed"
                data-model-toggle
                aria-label="选择模型"
              >
                <span className="mi-text">
                  <span className="mi-title">{cd?.name ?? cur?.label}</span>
                  {cd?.showId && <span className="model-id">{cd.id}</span>}
                  {cur?.description && <span className="mi-desc">{cur.description}</span>}
                </span>
                <span className="mi-caret">{CARET_SVG}</span>
              </button>
            )
          })()
        ) : (
          (hasQuery ? filteredModels : modelSection.list).map((m) => {
            const d = resolveModelDisplay(runtime.engine, m.value, { providerLabel: providerModels?.find((pm) => pm.value === m.value)?.label, officialLabel: m.label, modelAliases })
            return (
              <button
                key={m.value}
                type="button"
                className={`model-item${(m.description || d.showId) ? ' model-item-2l' : ''}${m.value === runtime.model ? ' is-active' : ''}`}
                data-model={m.value}
              >
                <span className="mi-text">
                  <span className="mi-title">{d.name}</span>
                  {d.showId && <span className="model-id">{d.id}</span>}
                  {m.description && <span className="mi-desc">{m.description}</span>}
                </span>
                <span className="mk">✓</span>
              </button>
            )
          })
        )}
      </div>
      )}

      {modelSection.collapsed && flyoutRect && !hasQuery && (
        <ModelFlyout
          rect={flyoutRect}
          models={modelSection.list}
          current={runtime.model}
          engine={runtime.engine}
          providerModels={providerModels}
          modelAliases={modelAliases}
          onPick={(value) => {
            dispatch({ type: 'SET_MODEL', model: value })
            setFlyoutRect(null)
            onClose()
          }}
          onOutside={() => setFlyoutRect(null)}
        />
      )}

      {/* Slash Commands 命令区（claude 专属，由 supportsDynamicModels 门控）：
          点行把 /name 填进输入框（不直接执行）。标题行带「注入技能」入口（P3）：点它对当前项目软链技能。 */}
      {commandsVisible && (
        <div className="model-group">
          <div className="model-group-h model-group-h-row">
            Slash Commands
            <button
              className="mg-inject"
              type="button"
              onClick={(e) => { e.stopPropagation(); onInjectSkill() }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 5v14M5 12h14" />
              </svg>
              注入技能
            </button>
          </div>
          {filteredCommands.map((c) => (
            <button key={c.name} type="button" className="model-item cmd-item" data-cmd={c.name}>
              <span className="ci-text">
                <span className="ci-name">/{c.name}</span>
                <span className="ci-desc">{c.description}</span>
              </span>
            </button>
          ))}
        </div>
      )}

      {nothingMatched && <div className="model-empty">无匹配项</div>}
      </div>
    </div>
  )
}

// ── ModelFlyout（折叠行右侧呼出的模型列表；fixed 附 body，不被 .model-pop overflow 裁切）──────

interface ModelFlyoutProps {
  rect: DOMRect
  models: UIModelOption[]
  current: string
  engine: Engine
  providerModels?: UIModelOption[]
  modelAliases?: Record<string, Record<string, string>>
  onPick: (value: string) => void
  onOutside: () => void
}

function ModelFlyout({ rect, models, current, engine, providerModels, modelAliases = {}, onPick, onOutside }: ModelFlyoutProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)

  // 渲染后量自身尺寸再定位：锚点右侧；放不下翻左；竖直对齐锚点顶端并夹在视口内
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const fw = el.offsetWidth
    const fh = el.offsetHeight
    let left = rect.right + 6
    if (left + fw > window.innerWidth - 8) left = Math.max(8, rect.left - fw - 6)
    let top = Math.min(rect.top, window.innerHeight - 8 - fh)
    if (top < 8) top = 8
    setPos({ left, top })
  }, [rect])

  // 点 flyout 外部 → 关（对齐原型 flyoutOutside；下一 tick 注册避开本次开 flyout 的 click）
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onOutside()
    }
    const t = setTimeout(() => document.addEventListener('click', handler), 0)
    return () => {
      clearTimeout(t)
      document.removeEventListener('click', handler)
    }
  }, [onOutside])

  return createPortal(
    <div
      ref={ref}
      className="model-flyout"
      style={{ left: pos?.left ?? rect.right + 6, top: pos?.top ?? rect.top, visibility: pos ? 'visible' : 'hidden' }}
      onClick={(e) => {
        e.stopPropagation()
        const item = (e.target as HTMLElement).closest('[data-model]') as HTMLElement | null
        if (!item) return
        onPick(item.getAttribute('data-model')!)
      }}
    >
      {models.map((m) => {
        const d = resolveModelDisplay(engine, m.value, { providerLabel: providerModels?.find((pm) => pm.value === m.value)?.label, officialLabel: m.label, modelAliases })
        return (
          <button
            key={m.value}
            type="button"
            className={`model-item model-item-2l${m.value === current ? ' is-active' : ''}`}
            data-model={m.value}
          >
            <span className="mi-text">
              <span className="mi-title">{d.name}</span>
              {d.showId && <span className="model-id">{d.id}</span>}
              {m.description && <span className="mi-desc">{m.description}</span>}
            </span>
            <span className="mk">✓</span>
          </button>
        )
      })}
    </div>,
    document.body,
  )
}

// ── OptRow（mode 段选项行；通用 data-mode-slot/data-mode-val）─────────────────

interface OptRowProps {
  active: boolean
  slot: string
  val: string
  zh: string
  en: string
}

function OptRow({ active, slot, val, zh, en }: OptRowProps) {
  // 用 button 而非 div，便于 userEvent.click
  return (
    <button
      type="button"
      className={`model-item opt-item${active ? ' is-active' : ''}`}
      data-mode-slot={slot}
      data-mode-val={val}
    >
      <span className="opt-t"><b>{zh}</b><i>{en}</i></span>
      <span className="mk">✓</span>
    </button>
  )
}
