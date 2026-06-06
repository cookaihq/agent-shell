/**
 * agents/claude/subagentView.ts — 子代理展示的 claude 切片辅助（形态 A 头行 / 形态 B 卡片 / 形态 C 入口三处复用）。
 *
 * 头像 = 类型首字母 + 类型色（蓝/橙/紫，按类型名稳定取色，避免渲染抖动）；
 * 状态徽章四态（运行中/完成/失败/中止，对齐 task_notification.status，色 token 见 base.css .sa-stat.*）；
 * 用量串「N 工具 · X tok · Ys」（来自 task_progress/notification 的 usage）。
 *
 * （Phase 2 平移自 workspace/subagentView.ts —— subagent 整条链归 claude 切片，spec §6。）
 */
import type { SubagentMeta } from '../../../api/types'

// 头像类型色类：amber / purple / blue(默认无修饰类)。按类型名哈希稳定取色 → 同类型恒定同色。
const SA_AVA_COLORS = ['general', 'research', ''] as const
export function saAvatarClass(type: string): string {
  let h = 0
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0
  return SA_AVA_COLORS[h % SA_AVA_COLORS.length]
}
export function saAvatarLetter(type: string): string {
  const m = type.match(/[a-z0-9]/i)
  return (m ? m[0] : '?').toUpperCase()
}

// 状态 → 徽章文案+类（color token：run 橙(--amber) / done 绿 / fail 红 / stop 灰(--text-muted)，spec R1）
export const SA_STAT: Record<SubagentMeta['status'], { label: string; cls: string }> = {
  running: { label: '运行中', cls: 'run' },
  completed: { label: '完成', cls: 'done' },
  failed: { label: '失败', cls: 'fail' },
  stopped: { label: '中止', cls: 'stop' },
}

const fmtTok = (n: number): string => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`)
export function fmtSaMeta(usage?: SubagentMeta['usage']): string {
  if (!usage) return ''
  const parts: string[] = []
  if (usage.toolUses) parts.push(`${usage.toolUses} 工具`)
  if (usage.totalTokens) parts.push(`${fmtTok(usage.totalTokens)} tok`)
  if (usage.durationMs) parts.push(`${Math.round(usage.durationMs / 1000)}s`)
  return parts.join(' · ')
}

/**
 * 按派生顺序去重的「可展示子代理」列表（taskId 主键），供形态 B 卡片 + 形态 C 头像堆叠复用。
 * - 去重：chatReducer 的 map 经 R2 根治后含 taskId + toolUseId 两键指同一 meta 引用，按 taskId 去重避免别名重复。
 * - D14 过滤：只保留**有 subagentType** 的条目。纯杂务（ambient/housekeeping，无 subagent_type）本期不展示，
 *   不当 Subagent（避免名不副实）。meta 经生命周期累计——started 阶段确立的 subagentType 已沉淀在 meta 上，
 *   即便 progress/ended 相位不带也不受影响。chatReducer 仍保留全量 map（形态 A 时间线经 toolUseId 别名命中需要它），
 *   过滤只发生在「进入展示列表」这一层。
 */
export function subagentList(map: Record<string, SubagentMeta>): SubagentMeta[] {
  const seen = new Set<string>()
  const out: SubagentMeta[] = []
  for (const m of Object.values(map)) {
    if (!m.subagentType) continue   // D14：无 subagent_type 的纯杂务不进展示列表
    if (!seen.has(m.taskId)) { seen.add(m.taskId); out.push(m) }
  }
  return out
}
