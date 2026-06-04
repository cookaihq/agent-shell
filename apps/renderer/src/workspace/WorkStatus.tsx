/**
 * WorkStatus.tsx — 运行中的实时状态行（● {动作} · N tokens）
 *
 * 挂在 ChatLog 底部，由 chatReducer.liveProgress 驱动（progress 事件 → 估算累计 token + 当前动作）。
 * 瞬时、不落库；turn_end 后 liveProgress 清空 → 本行消失。
 * 视觉对齐原型 workspace.html 的 .work-status（base.css .work-status 系列样式）。
 *
 * 动作措辞与 blocks/OpCard 对齐（读取/运行命令/编辑/任务计划），工具名判定用与 kindOf 一致的正则；
 * 无专门映射的工具走「正在调用 {工具名}」兜底（kindOf 对未知工具默认归 read，不能直接复用，故显式匹配）。
 */
import type { ProgressActivity } from './chatReducer'

// 取路径末段做简短展示（与 mock 的 styles.css 一致）；命令类 target 不在此展示。
const baseName = (p: string): string => p.split('/').pop() || p

// 超过千位用 K 缩写（如 7803 → 7.8K），千位以内显示原值。
const fmtTokens = (n: number): string => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}K`)

function activityLabel(a: ProgressActivity): string {
  if (a.kind === 'thinking') return '思考中'
  if (a.kind === 'responding') return '撰写回复'
  const file = a.target ? baseName(a.target) : ''
  if (/^(Edit|Write|MultiEdit)$/.test(a.tool)) return file ? `正在编辑 ${file}` : '正在编辑'
  if (a.tool === 'Read') return file ? `正在读取 ${file}` : '正在读取'
  if (a.tool === 'Bash') return '正在运行命令'
  if (a.tool === 'TodoWrite') return '更新任务计划'
  return a.tool ? `正在调用 ${a.tool}` : '处理中'
}

interface WorkStatusProps {
  tokens: number
  activity: ProgressActivity
}

export function WorkStatus({ tokens, activity }: WorkStatusProps) {
  return (
    <div className="work-status">
      <span className="ws-dot" />
      <span className="ws-label">{activityLabel(activity)}</span>
      <span className="ws-sep">·</span>
      <span className="ws-tokens"><b>{fmtTokens(tokens)}</b> tokens</span>
    </div>
  )
}
