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

export const CLI_MODELS: Record<string, string[]> = {
  claude: ['Claude Opus 4.8', 'Claude Opus 4.7', 'Claude Opus 4.6', 'Claude Opus 4.5', 'Claude Sonnet 4.6', 'Claude Haiku 4.5'],
  codex: ['GPT 5.5', 'GPT 5.4', 'GPT 5.3 Codex', 'GPT 5.4 Mini'],
}

export const AGENT_LABEL: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
}

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
    { id: 'max',    zh: '最大', en: 'Max' },
    { id: 'ultra',  zh: '超量', en: 'Ultra' },
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

export const CLAUDE_RISK: Record<string, string> = {
  default: 'ask',
  acceptEdits: 'mid',
  plan: 'low',
  auto: 'mid',
  bypassPermissions: 'high',
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
export type ClaudeEffort = 'low' | 'medium' | 'high' | 'max' | 'ultra'
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

// ── initialRuntime ────────────────────────────────────────────────────────────
// syncRuntime 回退逻辑：若 model 不在当前 agent 列表，回退到列表第一个 (L215)

export function initialRuntime(engine: Engine, model: string): RuntimeState {
  const list = CLI_MODELS[engine] ?? []
  const resolvedModel = list.includes(model) ? model : (list[0] ?? model)
  return {
    agent: engine,
    model: resolvedModel,
    claudeMode: 'default',
    codexApproval: 'on-request',
    codexSandbox: 'workspace-write',
    effort: {
      claude: 'high',
      codex: 'medium',
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
      const list = CLI_MODELS[action.agent] ?? []
      const model = list.includes(state.model) ? state.model : (list[0] ?? state.model)
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
export function useRuntimeReducer(engine: Engine, model: string): [RuntimeState, React.Dispatch<RuntimeAction>] {
  return useReducer(runtimeReducer, undefined, () => initialRuntime(engine, model))
}
