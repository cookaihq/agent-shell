/**
 * claude/chatUIConfig.ts — claude 切片运行时档位描述符
 *
 * 把原 runtimeState 里的 claude 专属知识下沉到此切片：
 *   - CLAUDE_MODES（5 档原生 permissionMode）+ 简称/风险色（chip）
 *   - claude EFFORTS（含 xhigh/max）
 *   - 模型段折叠 + VS Code 对齐（modelAlignment）
 *
 * 外壳 ModelPill/RuntimeSwitcher 渲染本切片返回的描述符，不再 if(agent==='claude')。
 */

import type {
  ChatUIConfig,
  RuntimeSlots,
  RuntimeChip,
  ModeSegment,
  ModelSection,
  EffortSection,
  UIModelOption,
} from '../types'
import { applyVscodeAlignment } from '../../modelAlignment'

// claude 原生权限档（方案 A）：5 档 1:1 映射 SDK permissionMode，随消息传给 daemon → query()，运行中可热切换。
export const CLAUDE_MODES: { id: string; zh: string; en: string }[] = [
  { id: 'default',           zh: '改动前都问', en: 'Ask before edits' },
  { id: 'acceptEdits',       zh: '自动编辑',   en: 'Edit automatically' },
  { id: 'plan',              zh: '计划模式',   en: 'Plan mode' },
  { id: 'auto',              zh: '自动模式',   en: 'Auto mode' },
  { id: 'bypassPermissions', zh: '绕过权限',   en: 'Bypass permissions' },
]

export const CLAUDE_EFFORTS: { id: string; zh: string; en: string }[] = [
  { id: 'low',    zh: '低',   en: 'Low' },
  { id: 'medium', zh: '中',   en: 'Medium' },
  { id: 'high',   zh: '高',   en: 'High' },
  { id: 'xhigh',  zh: '极高', en: 'xHigh' },   // 对齐 SDK EffortLevel（无 ultra、有 xhigh）
  { id: 'max',    zh: '最大', en: 'Max' },
]

// 胶囊简称 / 风险色（1:1 from app.js L156-161）
const CLAUDE_SHORT: Record<string, string> = {
  default: '询问',
  acceptEdits: '自动编辑',
  plan: '计划',
  auto: '自动',
  bypassPermissions: '绕过',
}

const CLAUDE_RISK: Record<string, 'low' | 'mid' | 'ask' | 'high'> = {
  default: 'ask',
  acceptEdits: 'mid',
  plan: 'low',
  auto: 'mid',
  bypassPermissions: 'high',
}

// claude 静态模型表（无活会话兜底；有活会话用 SDK supportedModels 动态列表）。
const STATIC_MODELS: UIModelOption[] = [
  { value: 'default', label: 'Default (recommended)' },
  { value: 'sonnet', label: 'Sonnet' },
  { value: 'haiku', label: 'Haiku' },
  { value: 'opus', label: 'Opus' },
  { value: 'opus[1m]', label: 'Opus 1M' },   // [合并自 main feedback-batch-2] 标签短化
]

/**
 * 模型段过 VS Code 对齐后的展示列表（ModelPill 弹窗 + chip 脸名用）。
 * 注意：getModelOptions 不走对齐——它是「原始可选列表 + 状态成员校验源」（与 RuntimeSwitcher 下拉一致），
 * 对齐只发生在「展示」层（弹窗段 / 脸名），避免把状态里合法的裸 'opus' value 洗没（回归 initialRuntime 行为）。
 */
function alignedModels(dyn?: UIModelOption[] | null): UIModelOption[] {
  const base =
    dyn && dyn.length > 0
      ? dyn.map((m) => ({ value: m.value, displayName: m.label, description: m.description }))
      : STATIC_MODELS.map((m) => ({ value: m.value, displayName: m.label, description: m.description }))
  return applyVscodeAlignment(base).map((m) => ({ value: m.value, label: m.displayName, description: m.description }))
}

export const claudeChatUIConfig: ChatUIConfig = {
  supportsDynamicModels: true,

  getDefaultSlots() {
    return { reasoning: 'high', permissionMode: 'default' }
  },

  getModelLabel(value, dyn) {
    const hit = alignedModels(dyn).find((m) => m.value === value)
    return hit?.label ?? value
  },

  getModelSection(state, dyn, providerModels): ModelSection {
    const hasPm = !!(providerModels && providerModels.length > 0)
    const list = hasPm ? providerModels! : alignedModels(dyn)
    const current = list.find((m) => m.value === state.model) ?? list[0]
    const dynamic = !hasPm && !!(dyn && dyn.length > 0)
    return { list, current, collapsed: true, groupLabel: 'Claude Code' + (hasPm ? ' · Provider' : dynamic ? ' · 动态' : '') }
  },

  // 原始可选列表（不对齐）：providerModels 有 → 优先用；否则 dyn 有 → dyn 原表；否则静态全表（含裸 'opus'）。
  // 既是 RuntimeSwitcher 下拉源，也是 runtimeState 成员校验源（含状态合法 value）。
  getModelOptions(_state, dyn, providerModels) {
    if (providerModels && providerModels.length > 0) return providerModels
    return dyn && dyn.length > 0 ? dyn : STATIC_MODELS
  },

  getModeSelector(state): ModeSegment[] {
    return [
      { key: 'permission', title: '权限', slot: 'permissionMode', options: CLAUDE_MODES, current: state.permissionMode },
    ]
  },

  getEffortSection(state): EffortSection {
    const current = CLAUDE_EFFORTS.find((l) => l.id === state.reasoning) ?? CLAUDE_EFFORTS[0]
    return { options: CLAUDE_EFFORTS, current }
  },

  getRuntimeChips(state): RuntimeChip[] {
    const chips: RuntimeChip[] = []
    const perm = state.permissionMode
    chips.push({ key: 'perm', text: CLAUDE_SHORT[perm] ?? perm, risk: CLAUDE_RISK[perm] ?? 'ask' })
    const eff = CLAUDE_EFFORTS.find((l) => l.id === state.reasoning) ?? CLAUDE_EFFORTS[0]
    if (eff) chips.push({ key: 'effort', text: eff.zh })
    return chips
  },
}
