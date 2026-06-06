/**
 * codex/chatUIConfig.ts — codex 切片运行时档位描述符
 *
 * codex 专属知识：审批策略 + 沙箱级别（两段，写 modeSelections）、codex EFFORTS（minimal..xhigh）。
 * 模型段平铺（无动态 supportedModels、无 VS Code 对齐）。
 *
 * 中立槽用法：approval/sandbox 住 modeSelections，reasoning 住 effort，permissionMode 不用。
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

export const CODEX_APPROVAL: { id: string; zh: string; en: string }[] = [
  { id: 'untrusted',  zh: '仅受信命令', en: 'Untrusted' },
  { id: 'on-request', zh: '按需询问',   en: 'On request' },
  { id: 'never',      zh: '从不询问',   en: 'Never' },
]

export const CODEX_SANDBOX: { id: string; zh: string; en: string }[] = [
  { id: 'read-only',          zh: '只读',       en: 'Read only' },
  { id: 'workspace-write',    zh: '工作区可写', en: 'Workspace write' },
  { id: 'danger-full-access', zh: '完全访问',   en: 'Full access' },
]

export const CODEX_EFFORTS: { id: string; zh: string; en: string }[] = [
  { id: 'minimal', zh: '最小', en: 'Minimal' },
  { id: 'low',     zh: '低',   en: 'Low' },
  { id: 'medium',  zh: '中',   en: 'Medium' },
  { id: 'high',    zh: '高',   en: 'High' },
  { id: 'xhigh',   zh: '极高', en: 'xHigh' },
]

const APPROVAL_SHORT: Record<string, string> = {
  untrusted: '受信',
  'on-request': '按需',
  never: '从不',
}

const SANDBOX_SHORT: Record<string, string> = {
  'read-only': '只读',
  'workspace-write': '工作区',
  'danger-full-access': '完全',
}

const SANDBOX_RISK: Record<string, 'low' | 'mid' | 'ask' | 'high'> = {
  'read-only': 'low',
  'workspace-write': 'mid',
  'danger-full-access': 'high',
}

// codex 静态模型表：value=真实 codex slug（传给 codex CLI `-m`，须与 ~/.codex/models_cache.json 的 slug 一致），
// label=友好展示名。把展示标签当 value 会让 codex CLI 报 "selected model ... may not exist"（slug 是小写带点，如 gpt-5.5）。
const STATIC_MODELS: UIModelOption[] = [
  { value: 'gpt-5.5', label: 'GPT 5.5' },
  { value: 'gpt-5.4', label: 'GPT 5.4' },
  { value: 'gpt-5.3-codex', label: 'GPT 5.3 Codex' },
  { value: 'gpt-5.4-mini', label: 'GPT 5.4 Mini' },
]

/** codex 默认槽：approval/sandbox 缺省回落（供 state.modeSelections 未填时）。 */
export const CODEX_DEFAULTS = { approval: 'on-request', sandbox: 'workspace-write' }

function approvalOf(state: RuntimeSlots): string {
  return state.modeSelections?.approval ?? CODEX_DEFAULTS.approval
}
function sandboxOf(state: RuntimeSlots): string {
  return state.modeSelections?.sandbox ?? CODEX_DEFAULTS.sandbox
}

export const codexChatUIConfig: ChatUIConfig = {
  supportsDynamicModels: false,

  getDefaultSlots() {
    // permissionMode 对 codex 不用（无对应字段），给个中立占位值；审批/沙箱住 modeSelections。
    return { reasoning: 'medium', permissionMode: 'default', modeSelections: { ...CODEX_DEFAULTS } }
  },

  getModelLabel(value) {
    return STATIC_MODELS.find((m) => m.value === value)?.label ?? value
  },

  getModelSection(state): ModelSection {
    const current = STATIC_MODELS.find((m) => m.value === state.model) ?? STATIC_MODELS[0]
    return { list: STATIC_MODELS, current, collapsed: false, groupLabel: 'Codex CLI' }
  },

  getModelOptions() {
    return STATIC_MODELS
  },

  getModeSelector(state): ModeSegment[] {
    return [
      { key: 'approval', title: '审批策略', slot: 'approval', options: CODEX_APPROVAL, current: approvalOf(state) },
      { key: 'sandbox', title: '沙箱级别', slot: 'sandbox', options: CODEX_SANDBOX, current: sandboxOf(state) },
    ]
  },

  getEffortSection(state): EffortSection {
    const current = CODEX_EFFORTS.find((l) => l.id === state.reasoning) ?? CODEX_EFFORTS[0]
    return { options: CODEX_EFFORTS, current }
  },

  getRuntimeChips(state): RuntimeChip[] {
    const approval = approvalOf(state)
    const sandbox = sandboxOf(state)
    const text = (APPROVAL_SHORT[approval] ?? approval) + '·' + (SANDBOX_SHORT[sandbox] ?? sandbox)
    const chips: RuntimeChip[] = [{ key: 'perm', text, risk: SANDBOX_RISK[sandbox] ?? 'mid' }]
    const eff = CODEX_EFFORTS.find((l) => l.id === state.reasoning) ?? CODEX_EFFORTS[0]
    if (eff) chips.push({ key: 'effort', text: eff.zh })
    return chips
  },
}
