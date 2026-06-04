/**
 * runtimeState.ts — runtime 前端状态
 *
 * 常量 1:1 移植自 prototype/原型开发版/app.js L102-173
 * chipPerm / chipEffort 移植自 L162-173
 * syncRuntime 回退逻辑移植自 L213-215
 *
 * 这套状态后续被 Task 16 ModelPill 复用，导出保持稳定完整。
 */

import { createContext, useContext, useReducer } from 'react'
import type { Engine } from '../api/types'

// ── 常量 (1:1 from app.js L102-173) ─────────────────────────────────────────

/** 模型选项：value=发给 daemon/SDK 的标识（claude 用 SDK 别名/变体，如 opus、opus[1m]），label=展示名，description=副标题（可选）。
 *  claude 这张静态表只作「无活动会话时的兜底」+「按 value 查展示名」；有活动会话时下拉直接用 SDK supportedModels()
 *  返回的动态列表（带真实 value/displayName/description，含 1M 变体）。codex 无动态列表，value=label。 */
export interface ModelOption { value: string; label: string; description?: string }
export const CLI_MODELS: Record<string, ModelOption[]> = {
  claude: [
    { value: 'default', label: 'Default (recommended)' },
    { value: 'sonnet', label: 'Sonnet' },
    { value: 'haiku', label: 'Haiku' },
    { value: 'opus', label: 'Opus' },
    { value: 'opus[1m]', label: 'Opus (1M context)' },
  ],
  codex: [
    { value: 'GPT 5.5', label: 'GPT 5.5' },
    { value: 'GPT 5.4', label: 'GPT 5.4' },
    { value: 'GPT 5.3 Codex', label: 'GPT 5.3 Codex' },
    { value: 'GPT 5.4 Mini', label: 'GPT 5.4 Mini' },
  ],
}

/** 在动态(SDK)/静态列表里按 value 查展示名；都查不到则回退 value 自身。chip 用它把别名渲染成展示名。 */
export function modelLabel(agent: string, value: string, dyn?: { value: string; displayName: string }[] | null): string {
  const d = dyn?.find((m) => m.value === value)
  if (d) return d.displayName
  const s = (CLI_MODELS[agent] ?? []).find((m) => m.value === value)
  return s?.label ?? value
}

export const AGENT_LABEL: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
}

// claude 原生权限档（方案 A）：5 档 1:1 映射 SDK permissionMode，随消息传给 daemon → query()，运行中可热切换。
export const CLAUDE_MODES: { id: string; zh: string; en: string }[] = [
  { id: 'default',           zh: '改动前都问', en: 'Ask before edits' },
  { id: 'acceptEdits',       zh: '自动编辑',   en: 'Edit automatically' },
  { id: 'plan',              zh: '计划模式',   en: 'Plan mode' },
  { id: 'auto',              zh: '自动模式',   en: 'Auto mode' },
  { id: 'bypassPermissions', zh: '绕过权限',   en: 'Bypass permissions' },
]

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

export const EFFORTS: Record<string, { id: string; zh: string; en: string }[]> = {
  claude: [
    { id: 'low',    zh: '低',   en: 'Low' },
    { id: 'medium', zh: '中',   en: 'Medium' },
    { id: 'high',   zh: '高',   en: 'High' },
    { id: 'xhigh',  zh: '极高', en: 'xHigh' },   // 对齐 SDK EffortLevel（无 ultra、有 xhigh）
    { id: 'max',    zh: '最大', en: 'Max' },
  ],
  codex: [
    { id: 'minimal', zh: '最小', en: 'Minimal' },
    { id: 'low',     zh: '低',   en: 'Low' },
    { id: 'medium',  zh: '中',   en: 'Medium' },
    { id: 'high',    zh: '高',   en: 'High' },
    { id: 'xhigh',   zh: '极高', en: 'xHigh' },
  ],
}

// 胶囊简称 / 风险色 (1:1 from app.js L156-161)
export const CLAUDE_SHORT: Record<string, string> = {
  default: '询问',
  acceptEdits: '自动编辑',
  plan: '计划',
  auto: '自动',
  bypassPermissions: '绕过',
}

export const CLAUDE_RISK: Record<string, string> = {
  default: 'ask',
  acceptEdits: 'mid',
  plan: 'low',
  auto: 'mid',
  bypassPermissions: 'high',
}

export const APPROVAL_SHORT: Record<string, string> = {
  untrusted: '受信',
  'on-request': '按需',
  never: '从不',
}

export const SANDBOX_SHORT: Record<string, string> = {
  'read-only': '只读',
  'workspace-write': '工作区',
  'danger-full-access': '完全',
}

export const CODEX_RISK: Record<string, string> = {
  'read-only': 'low',
  'workspace-write': 'mid',
  'danger-full-access': 'high',
}

export const RISK_COLOR: Record<string, string> = {
  low: 'var(--green)',
  mid: 'var(--blue)',
  ask: 'var(--amber)',
  high: 'var(--red)',
}

// ── 类型 ────────────────────────────────────────────────────────────────────

export type ClaudeMode = 'default' | 'acceptEdits' | 'plan' | 'auto' | 'bypassPermissions'
export type CodexApproval = 'untrusted' | 'on-request' | 'never'
export type CodexSandbox = 'read-only' | 'workspace-write' | 'danger-full-access'
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type CodexEffort = 'minimal' | 'low' | 'medium' | 'high' | 'xhigh'

export interface RuntimeState {
  agent: Engine
  model: string
  claudeMode: ClaudeMode
  codexApproval: CodexApproval
  codexSandbox: CodexSandbox
  effort: {
    claude: ClaudeEffort
    codex: CodexEffort
  }
}

// ── Actions ──────────────────────────────────────────────────────────────────

export type RuntimeAction =
  | { type: 'SET_AGENT'; agent: Engine }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'SET_CLAUDE_MODE'; claudeMode: ClaudeMode }
  | { type: 'SET_CODEX_APPROVAL'; codexApproval: CodexApproval }
  | { type: 'SET_CODEX_SANDBOX'; codexSandbox: CodexSandbox }
  | { type: 'SET_EFFORT'; agent: Engine; effortId: string }

// ── 上次运行时配置缓存（Issue 13：同一 CLI 复用上次档位）────────────────────────
// 全局 localStorage（非按项目）：claude/codex 各自档位分槽，切 CLI 各取各的。
const LAST_RT_KEY = 'agent-shell:last-runtime'
interface LastRuntime {
  claudeMode?: ClaudeMode
  claudeEffort?: ClaudeEffort
  codexEffort?: CodexEffort
  codexApproval?: CodexApproval
  codexSandbox?: CodexSandbox
}
export function loadLastRuntime(): LastRuntime {
  try { return JSON.parse(localStorage.getItem(LAST_RT_KEY) ?? '{}') as LastRuntime } catch { return {} }
}
export function saveLastRuntime(rt: RuntimeState): void {
  try {
    localStorage.setItem(LAST_RT_KEY, JSON.stringify({
      claudeMode: rt.claudeMode, claudeEffort: rt.effort.claude, codexEffort: rt.effort.codex,
      codexApproval: rt.codexApproval, codexSandbox: rt.codexSandbox,
    }))
  } catch { /* noop */ }
}

// ── initialRuntime ────────────────────────────────────────────────────────────
// 档位来源优先级（Issue 13/29）：会话已存的 init（DB 回填，反映本会话真实配置）
//   > localStorage 上次使用（新会话复用上次） > 写死默认。
// model 仍走 syncRuntime 回退：不在当前 agent 列表则回退列表首个 (L215)。

/** 打开会话时回填的会话级档位（来自 DB sessions 表）。 */
export interface RuntimeInit { permissionMode?: string | null; effort?: string | null }

export function initialRuntime(engine: Engine, model: string, init?: RuntimeInit): RuntimeState {
  const values = (CLI_MODELS[engine] ?? []).map((m) => m.value)
  const resolvedModel = values.includes(model) ? model : (values[0] ?? model)
  const last = loadLastRuntime()
  const claudeMode = (init?.permissionMode ?? last.claudeMode ?? 'default') as ClaudeMode
  // 会话存的 effort 归当前引擎槽；另一引擎取上次缓存 / 默认
  const claudeEffort = ((engine === 'claude' ? init?.effort : null) ?? last.claudeEffort ?? 'high') as ClaudeEffort
  const codexEffort = ((engine === 'codex' ? init?.effort : null) ?? last.codexEffort ?? 'medium') as CodexEffort
  return {
    agent: engine,
    model: resolvedModel,
    claudeMode,
    codexApproval: last.codexApproval ?? 'on-request',
    codexSandbox: last.codexSandbox ?? 'workspace-write',
    effort: {
      claude: claudeEffort,
      codex: codexEffort,
    },
  }
}

// ── 纯函数：chipPerm (1:1 from app.js L162-167) ──────────────────────────────

export function chipPerm(rt: RuntimeState): { text: string; risk: string } | null {
  if (rt.agent === 'claude') {
    return { text: CLAUDE_SHORT[rt.claudeMode] ?? rt.claudeMode, risk: CLAUDE_RISK[rt.claudeMode] ?? 'ask' }
  }
  if (rt.agent === 'codex') {
    return {
      text: (APPROVAL_SHORT[rt.codexApproval] ?? rt.codexApproval) + '·' + (SANDBOX_SHORT[rt.codexSandbox] ?? rt.codexSandbox),
      risk: CODEX_RISK[rt.codexSandbox] ?? 'mid',
    }
  }
  return null
}

// ── 纯函数：chipEffort (1:1 from app.js L168-173) ─────────────────────────────

export function chipEffort(rt: RuntimeState): string | null {
  const levels = EFFORTS[rt.agent]
  if (!levels) return null
  const curId = rt.effort[rt.agent]
  const cur = levels.find(l => l.id === curId) ?? levels[0]
  return cur?.zh ?? null
}

// ── Reducer ───────────────────────────────────────────────────────────────────

export function runtimeReducer(state: RuntimeState, action: RuntimeAction): RuntimeState {
  switch (action.type) {
    case 'SET_AGENT': {
      const values = (CLI_MODELS[action.agent] ?? []).map((m) => m.value)
      const model = values.includes(state.model) ? state.model : (values[0] ?? state.model)
      return { ...state, agent: action.agent, model }
    }
    case 'SET_MODEL':
      return { ...state, model: action.model }
    case 'SET_CLAUDE_MODE':
      return { ...state, claudeMode: action.claudeMode }
    case 'SET_CODEX_APPROVAL':
      return { ...state, codexApproval: action.codexApproval }
    case 'SET_CODEX_SANDBOX':
      return { ...state, codexSandbox: action.codexSandbox }
    case 'SET_EFFORT':
      return { ...state, effort: { ...state.effort, [action.agent]: action.effortId } }
    default:
      return state
  }
}

// ── React Context + hook ──────────────────────────────────────────────────────

export interface RuntimeContextValue {
  runtime: RuntimeState
  dispatch: React.Dispatch<RuntimeAction>
}

export const RuntimeContext = createContext<RuntimeContextValue | null>(null)

export function useRuntime(): RuntimeContextValue {
  const ctx = useContext(RuntimeContext)
  if (!ctx) throw new Error('useRuntime must be used inside RuntimeContext.Provider')
  return ctx
}

/**
 * useRuntimeReducer — 封装 useReducer(runtimeReducer, ..., initializer)
 * 供 Task 14 Workspace 组件调用，返回 [runtime, dispatch]
 * RuntimeContext.Provider 在 Workspace 层包裹所有子组件
 */
export function useRuntimeReducer(engine: Engine, model: string, init?: RuntimeInit): [RuntimeState, React.Dispatch<RuntimeAction>] {
  return useReducer(runtimeReducer, undefined, () => initialRuntime(engine, model, init))
}
