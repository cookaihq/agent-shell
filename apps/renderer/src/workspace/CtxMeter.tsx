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
import { useState } from 'react'
import type { UsageDTO } from '../api/types'

// ── 格式化工具 ────────────────────────────────────────────────────────────────

function fmtTokens(n: number): string {
  if (n === 0) return '0 tokens'
  if (n < 1000) return `${n} tokens`
  return `${(n / 1000).toFixed(1)}k tokens`
}

function fmtCost(usd: number): string {
  return `≈ $${usd.toFixed(2)}`
}

// ── 上下文用量占位计算 ─────────────────────────────────────────────────────────
// [占位] CLI 不直接提供 context window 使用率，使用 inputTokens 估算（假设 200k 窗口）
// 真实联动留后续子里程碑
const CTX_WINDOW = 200_000

function ctxPercent(usage: UsageDTO | undefined): number {
  if (!usage) return 0
  return Math.min(100, Math.round((usage.inputTokens / CTX_WINDOW) * 100))
}

function ctxUsedLabel(usage: UsageDTO | undefined): string {
  if (!usage || usage.inputTokens === 0) return '已用 0 / 200k'
  const used = usage.inputTokens < 1000
    ? `${usage.inputTokens}`
    : `${(usage.inputTokens / 1000).toFixed(1)}k`
  return `已用 ${used} / 200k`
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
}

export function CtxMeter({ usage }: CtxMeterProps) {
  const [open, setOpen] = useState(false)

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation()
    setOpen(v => !v)
  }

  const inputTokens  = usage?.inputTokens  ?? 0
  const outputTokens = usage?.outputTokens ?? 0
  const costUsd      = usage?.costUsd      ?? 0
  const pct = ctxPercent(usage)

  return (
    <div className="ctx-wrap">
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
          <div className="ctx-pop-h">本次会话</div>
          <div className="ctx-row">
            <span>输入</span>
            <b>{fmtTokens(inputTokens)}</b>
          </div>
          <div className="ctx-row">
            <span>输出</span>
            <b>{fmtTokens(outputTokens)}</b>
          </div>
          <div className="ctx-row">
            <span>费用</span>
            <b>{fmtCost(costUsd)}</b>
          </div>
        </div>

        {/* 上下文用量（占位：基于 inputTokens / 200k 估算） */}
        <div className="ctx-pop-sec">
          <div className="ctx-pop-h">上下文</div>
          <div className="ctx-bar">
            <span style={{ width: `${pct}%` }} />
          </div>
          <div className="ctx-row">
            <span>{ctxUsedLabel(usage)}</span>
            <b>{pct}%</b>
          </div>
          <div className="ctx-note">
            剩余约 {Math.round((CTX_WINDOW - inputTokens) / 1000)}k，超出后会自动压缩较早的消息
          </div>
        </div>
      </div>
    </div>
  )
}
