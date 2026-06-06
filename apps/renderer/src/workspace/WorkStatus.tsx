/**
 * WorkStatus.tsx — 运行中的实时状态行（● {动作} · N tokens）
 *
 * 挂在 ChatLog 底部，由 chatReducer.liveProgress 驱动（progress 事件 → 估算累计 token + 当前动作）。
 * 瞬时、不落库；turn_end 后 liveProgress 清空 → 本行消失。
 * 视觉对齐原型 workspace.html 的 .work-status（base.css .work-status 系列样式）。
 *
 * Dumb 件：只接收已翻译好的 label 字符串（activity→label 翻译由各 Agent 切片负责）。
 * 无 label → 起步态（脉冲点 + 「处理中…」，无 tokens 段）。
 */

// 超过千位用 K 缩写（如 7803 → 7.8K），千位以内显示原值。
const fmtTokens = (n: number): string => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}K`)

interface WorkStatusProps {
  tokens?: number
  label?: string
}

export function WorkStatus({ tokens, label }: WorkStatusProps) {
  // 起步态（发送后、首个 progress 事件到来前）：只显示脉冲点 + 「处理中…」，不留空窗。
  if (!label) {
    return (
      <div className="work-status">
        <span className="ws-dot" />
        <span className="ws-label">处理中…</span>
      </div>
    )
  }
  return (
    <div className="work-status">
      <span className="ws-dot" />
      <span className="ws-label">{label}</span>
      <span className="ws-sep">·</span>
      <span className="ws-tokens"><b>{fmtTokens(tokens ?? 0)}</b> tokens</span>
    </div>
  )
}
