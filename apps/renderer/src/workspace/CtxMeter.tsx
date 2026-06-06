/**
 * CtxMeter.tsx — Task 18
 *
 * 上下文用量计量环 + 弹窗。移植 app.js (L587-600) + workspace.html L70-85。
 *
 * 结构（对齐原型）：
 *   .ctx-wrap
 *     > .ctx-meter[.is-open] (环 svg) — 点击开合弹窗
 *     > .ctx-pop[hidden]
 *         > .ctx-pop-sec
 *             > .ctx-pop-h + .ctx-row*3（输入/输出/费用）
 *         > .ctx-pop-sec
 *             > .ctx-pop-h + .ctx-bar + .ctx-row + .ctx-note（上下文用量，占位）
 *
 * token 格式化：48200 → "48.2k"，12100 → "12.1k"
 * 费用格式化：0.41 → "≈ $0.41"
 *
 * 上下文窗口百分比：CLI 不直接提供，用占位（基于 usage 估算，标注占位）。
 */
import { useEffect, useRef, useState } from 'react'
import type { UsageDTO } from '../api/types'
import type { Engine } from '@agent-shell/contracts'
import { getSlice } from './agents/registry'

// ── 格式化工具 ────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n === 0) return '0 tokens'
  if (n < 1000) return `${n} tokens`
  return `${(n / 1000).toFixed(1)}K tokens`
}

function fmtCost(usd: number): string {
  return `≈ $${usd.toFixed(2)}`
}

// ── 上下文用量计算 ─────────────────────────────────────────────────────────────
// 窗口大小用 SDKResultMessage.contextWindow 的权威值（usage.contextWindow）；无则按模型取缓存；再无才回落 200k。
// SDK ModelInfo 不带窗口字段（已查证），故窗口只能从运行时 result.modelUsage.contextWindow 拿到后按模型缓存（Issue 12）。
const DEFAULT_CTX_WINDOW = 200_000

const CTX_WIN_KEY = 'agent-shell:ctx-window'
function readWinCache(): Record<string, number> {
  try { return JSON.parse(localStorage.getItem(CTX_WIN_KEY) ?? '{}') as Record<string, number> } catch { return {} }
}
function rememberWin(model: string | undefined, win: number | undefined): void {
  if (!model || !win) return
  try {
    const c = readWinCache()
    if (c[model] === win) return
    c[model] = win
    localStorage.setItem(CTX_WIN_KEY, JSON.stringify(c))
  } catch { /* noop */ }
}
function cachedWin(model: string | undefined): number | undefined {
  if (!model) return undefined
  return readWinCache()[model]
}

const ctxWindow = (usage: UsageDTO | undefined, model?: string, engine?: Engine): number =>
  usage?.contextWindow || cachedWin(model) || (engine ? getSlice(engine).getContextWindowSize?.(model ?? '') : undefined) || DEFAULT_CTX_WINDOW
const fmtK = (n: number): string => (n < 1000 ? `${n}` : `${Math.round(n / 1000)}k`)

function ctxPercent(used: number, win: number): number {
  return Math.min(100, Math.round((used / win) * 100))
}

function ctxUsedLabel(used: number, win: number): string {
  if (used <= 0) return `已用 0 / ${fmtK(win)}`
  const u = used < 1000 ? `${used}` : `${(used / 1000).toFixed(1)}k`
  return `已用 ${u} / ${fmtK(win)}`
}

// ── SVG 计量环 ────────────────────────────────────────────────────────────────
// 对齐原型 workspace.html L71-73：r=9，stroke-dasharray=56.5（≈2π×9）
// stroke-dashoffset = 56.5 × (1 - pct/100)  越小 → 环越满

const CIRCUMFERENCE = 56.5 // 2 * π * 9 ≈ 56.55，原型值

function RingProgress({ pct }: { pct: number }) {
  const offset = CIRCUMFERENCE * (1 - pct / 100)
  return (
    <svg width="19" height="19" viewBox="0 0 24 24" fill="none">
      <circle
        className="ring-track"
        cx="12" cy="12" r="9"
        strokeWidth={3}
      />
      <circle
        className="ring-prog"
        cx="12" cy="12" r="9"
        strokeWidth={3}
        strokeLinecap="round"
        strokeDasharray={CIRCUMFERENCE}
        strokeDashoffset={offset}
        transform="rotate(-90 12 12)"
      />
    </svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

interface CtxMeterProps {
  usage?: UsageDTO
  /** 当前模型（上下文窗口按模型缓存的键，Issue 12）。 */
  model?: string
  /** 运行中的实时 token 估算（来自 progress 事件）；提供即表示本轮进行中（Issue 10 实时同步）。 */
  liveTokens?: number
  /** 引擎标识符（claude/codex）——用于切片 getContextWindowSize 回落（Task 1.5）。 */
  engine: Engine
}

export function CtxMeter({ usage, model, liveTokens, engine }: CtxMeterProps) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef<HTMLDivElement>(null)

  // 运行时拿到真实上下文窗口 → 按模型缓存，供新会话（尚无 result）直接显示真实窗口而非写死 200k
  useEffect(() => { rememberWin(model, usage?.contextWindow) }, [model, usage?.contextWindow])

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(v => !v)
  }

  // wirePopover 式（对齐 ChatHeader.tsx:88-97）：点弹窗外部 / 按 Escape 关闭
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const inputTokens  = usage?.inputTokens  ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  const costUsd      = usage?.costUsd  // undefined = no cost data (codex / unset)
  const win = ctxWindow(usage, model, engine)
  // Task 1.5：上下文「已用」基准优先用 contextTokens（含 cache creation + cache read = 真实占用），
  // 回落 inputTokens（旧路径，无 cache 时等价）。
  // Issue 10：本轮进行中（liveTokens 有值）时叠加实时输出估算（output 也占窗口）。
  const ctxBase = usage?.contextTokens ?? inputTokens
  const live = liveTokens != null
  const liveOut = live ? Math.max(outputTokens, liveTokens) : outputTokens
  const usedTokens = ctxBase + (live ? Math.max(0, liveTokens - outputTokens) : 0)
  const pct = ctxPercent(usedTokens, win)

  return (
    <div className="ctx-wrap" ref={wrapRef}>
      <button
        className={`ctx-meter${open ? ' is-open' : ''}`}
        id="ctxMeter"
        title="本次会话用量与上下文"
        type="button"
        onClick={toggleOpen}
      >
        <RingProgress pct={pct} />
      </button>

      <div className="ctx-pop" id="ctxPop" hidden={!open}>
        {/* 本次会话 */}
        <div className="ctx-pop-sec">
          <div className="ctx-pop-h">本次会话{live && <span className="ctx-live">· 实时</span>}</div>
          <div className="ctx-row">
            <span>输入</span>
            <b>{fmtTokens(inputTokens)}</b>
          </div>
          <div className="ctx-row">
            <span>输出{live && liveOut > outputTokens ? ' (估算)' : ''}</span>
            <b>{fmtTokens(liveOut)}</b>
          </div>
          {costUsd !== undefined && (
            <div className="ctx-row">
              <span>费用</span>
              <b>{fmtCost(costUsd)}</b>
            </div>
          )}
        </div>

        {/* 上下文用量：窗口取真实 contextWindow（按模型缓存），运行中叠加实时输出估算 */}
        <div className="ctx-pop-sec">
          <div className="ctx-pop-h">上下文</div>
          <div className="ctx-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="ctx-row">
            <span>{ctxUsedLabel(usedTokens, win)}</span>
            <b>{pct}%</b>
          </div>
          <div className="ctx-note">
            剩余约 {Math.max(0, Math.round((win - usedTokens) / 1000))}k，超出后会自动压缩较早的消息
          </div>
        </div>
      </div>
    </div>
  )
}
