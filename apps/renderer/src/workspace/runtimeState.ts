/**
 * runtimeState.ts — runtime 前端状态（中立槽 · spec §7）
 *
 * 外壳 RuntimeState 只留中立槽，不解释 'acceptEdits'/'workspace-write' 的语义：
 *   { engine, model, reasoning, permissionMode, modeSelections? } —— 全是 string。
 * 各 Agent 专属知识（权限档/审批/沙箱/effort 常量、chip 描述、模型对齐）下沉到
 * agents/{engine}/chatUIConfig.ts 切片，本文件零 if(agent==='x')。
 *
 * per-agent 投影 bag（取代扁平 localStorage，Issue 13）：savedProviderState
 *   = { model/reasoning/permissionMode/mode.{slot}: Record<agentId,string> }；
 * 切 agent → 把该 agent 上次值投影回 active 槽（满足「切 CLI 复用上次档位」）。
 */

import { createContext, useContext, useReducer } from 'react'
import type { Engine } from '../api/types'
import { SLICES } from './agents/registry'
import type { RuntimeSlots, RiskLevel } from './agents/types'

// ── 中立风险枚举 → 色（外壳上色用；中立，不解释语义）────────────────────────────
export const RISK_COLOR: Record<RiskLevel, string> = {
  low: 'var(--green)',
  mid: 'var(--blue)',
  ask: 'var(--amber)',
  high: 'var(--red)',
}

export const AGENT_LABEL: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex CLI',
}

// ── 默认档位（中立 string；具体含义由切片解释）──────────────────────────────────
// 默认值由切片 getDefaultSlots() 提供，外壳不硬编码各引擎默认档位（不解释语义）。
function defaultSlots(engine: Engine) {
  return SLICES[engine].chatUIConfig.getDefaultSlots()
}

/** 各引擎可选 model value 列表（无活会话兜底 + 状态成员校验源；取自切片 getModelOptions）。 */
function modelValues(engine: Engine): string[] {
  return SLICES[engine].chatUIConfig.getModelOptions({ engine, model: '', reasoning: '', permissionMode: '' }).map((m) => m.value)
}

// ── 中立 RuntimeState（= RuntimeSlots + 投影 bag）──────────────────────────────

/** 投影 bag：field → (agentId → 上次值)。field ∈ {model,reasoning,permissionMode,mode.{slot}}。 */
export type SavedProviderState = Record<string, Record<string, string>>

export interface RuntimeState extends RuntimeSlots {
  /** per-agent 投影 bag（Issue 13：切 CLI 复用上次档位）。 */
  savedProviderState: SavedProviderState
}

// ── Actions ──────────────────────────────────────────────────────────────────

export type RuntimeAction =
  | { type: 'SET_AGENT'; agent: Engine }
  | { type: 'SET_MODEL'; model: string }
  | { type: 'SET_REASONING'; reasoning: string }
  | { type: 'SET_PERMISSION_MODE'; permissionMode: string }
  /** 通用多段选择器写入（codex approval/sandbox 等）。slot 为切片 ModeSegment.slot。 */
  | { type: 'SET_MODE_SELECTION'; slot: string; value: string }

// ── 上次运行时配置缓存（Issue 13）— 持久化为投影 bag ─────────────────────────────
// 全局 localStorage（非按项目）：每个 field 各 agent 分槽，切 agent 各取各的。
const LAST_RT_KEY = 'agent-shell:saved-provider-state'

export function loadSavedProviderState(): SavedProviderState {
  try {
    const raw = JSON.parse(localStorage.getItem(LAST_RT_KEY) ?? '{}')
    return (raw && typeof raw === 'object') ? raw as SavedProviderState : {}
  } catch { return {} }
}

export function saveProviderState(bag: SavedProviderState): void {
  try { localStorage.setItem(LAST_RT_KEY, JSON.stringify(bag)) } catch { /* noop */ }
}

/** 把当前 active 槽写进投影 bag 的 [field][engine]（不可变更新）。 */
function rememberSlots(bag: SavedProviderState, engine: Engine, slots: RuntimeSlots): SavedProviderState {
  const next: SavedProviderState = { ...bag }
  const put = (field: string, value: string | undefined) => {
    if (value === undefined) return
    next[field] = { ...(next[field] ?? {}), [engine]: value }
  }
  put('model', slots.model)
  put('reasoning', slots.reasoning)
  put('permissionMode', slots.permissionMode)
  for (const [slot, value] of Object.entries(slots.modeSelections ?? {})) put('mode.' + slot, value)
  return next
}

/** 从投影 bag 取某 field 某 agent 的值。 */
function recall(bag: SavedProviderState, field: string, engine: Engine): string | undefined {
  return bag[field]?.[engine]
}

// ── initialRuntime ────────────────────────────────────────────────────────────
// 档位来源优先级（Issue 13/29）：会话已存的 init（DB 回填）> localStorage 上次使用 > 写死默认。
// model 走回退：不在当前 agent 列表则回退列表首个。

/** 打开会话时回填的会话级档位（来自 DB sessions 表）。 */
export interface RuntimeInit { permissionMode?: string | null; effort?: string | null }

export function initialRuntime(engine: Engine, model: string, init?: RuntimeInit): RuntimeState {
  const bag = loadSavedProviderState()
  const def = defaultSlots(engine)
  const values = modelValues(engine)
  const savedModel = recall(bag, 'model', engine)
  const wantModel = values.includes(model) ? model : (savedModel && values.includes(savedModel) ? savedModel : (values[0] ?? model))

  // 会话存的 permissionMode/effort 反映本会话真实配置（最高优先）；否则投影 bag；否则默认。
  const permissionMode = init?.permissionMode ?? recall(bag, 'permissionMode', engine) ?? def.permissionMode
  const reasoning = (init?.effort ?? recall(bag, 'reasoning', engine) ?? def.reasoning)

  const modeSelections = def.modeSelections
    ? Object.fromEntries(Object.keys(def.modeSelections).map((slot) => [slot, recall(bag, 'mode.' + slot, engine) ?? def.modeSelections![slot]]))
    : undefined

  const slots: RuntimeSlots = { engine, model: wantModel, reasoning, permissionMode, modeSelections }
  return { ...slots, savedProviderState: rememberSlots(bag, engine, slots) }
}

// ── Reducer ───────────────────────────────────────────────────────────────────

/** 拆出纯槽位（去掉 savedProviderState），供切片/POST 使用。 */
export function slotsOf(state: RuntimeState): RuntimeSlots {
  return { engine: state.engine, model: state.model, reasoning: state.reasoning, permissionMode: state.permissionMode, modeSelections: state.modeSelections }
}

export function runtimeReducer(state: RuntimeState, action: RuntimeAction): RuntimeState {
  switch (action.type) {
    case 'SET_AGENT': {
      const engine = action.agent
      const def = defaultSlots(engine)
      const bag = state.savedProviderState
      const values = modelValues(engine)
      // 投影该 agent 上次值回 active 槽（Issue 13）；缺失回落默认。
      const savedModel = recall(bag, 'model', engine)
      const model = savedModel && values.includes(savedModel) ? savedModel : (values.includes(state.model) ? state.model : (values[0] ?? state.model))
      const reasoning = recall(bag, 'reasoning', engine) ?? def.reasoning
      const permissionMode = recall(bag, 'permissionMode', engine) ?? def.permissionMode
      const modeSelections = def.modeSelections
        ? Object.fromEntries(Object.keys(def.modeSelections).map((slot) => [slot, recall(bag, 'mode.' + slot, engine) ?? def.modeSelections![slot]]))
        : undefined
      const slots: RuntimeSlots = { engine, model, reasoning, permissionMode, modeSelections }
      return { ...slots, savedProviderState: rememberSlots(bag, engine, slots) }
    }
    case 'SET_MODEL': {
      const slots: RuntimeSlots = { ...slotsOf(state), model: action.model }
      return { ...slots, savedProviderState: rememberSlots(state.savedProviderState, state.engine, slots) }
    }
    case 'SET_REASONING': {
      const slots: RuntimeSlots = { ...slotsOf(state), reasoning: action.reasoning }
      return { ...slots, savedProviderState: rememberSlots(state.savedProviderState, state.engine, slots) }
    }
    case 'SET_PERMISSION_MODE': {
      const slots: RuntimeSlots = { ...slotsOf(state), permissionMode: action.permissionMode }
      return { ...slots, savedProviderState: rememberSlots(state.savedProviderState, state.engine, slots) }
    }
    case 'SET_MODE_SELECTION': {
      const modeSelections = { ...(state.modeSelections ?? {}), [action.slot]: action.value }
      const slots: RuntimeSlots = { ...slotsOf(state), modeSelections }
      return { ...slots, savedProviderState: rememberSlots(state.savedProviderState, state.engine, slots) }
    }
    default:
      return state
  }
}

// ── 持久化（Issue 13）：每次状态变化把投影 bag 落 localStorage ──────────────────
export function saveLastRuntime(rt: RuntimeState): void {
  saveProviderState(rt.savedProviderState)
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
 * RuntimeContext.Provider 在 Workspace/AppNav 层包裹所有子组件。
 */
export function useRuntimeReducer(engine: Engine, model: string, init?: RuntimeInit): [RuntimeState, React.Dispatch<RuntimeAction>] {
  return useReducer(runtimeReducer, undefined, () => initialRuntime(engine, model, init))
}

// ── 向后兼容导出（AppNav/ExecMode 仍引用 CLI_MODELS 的扁平形态）────────────────
// 这是「无活会话时的兜底模型表 + 按 value 查展示名」的中立列表，由切片 getModelOptions 派生，
// 不含任何 agent 分支逻辑（分支在切片内部）。AppNav 用 CLI_MODELS[engine][0].value 作种子模型；
// ExecMode 用它列设置页 model chips（纯展示态）。
export interface ModelOption { value: string; label: string; description?: string }
export const CLI_MODELS: Record<string, ModelOption[]> = Object.fromEntries(
  (Object.keys(SLICES) as Engine[]).map((engine) => [
    engine,
    SLICES[engine].chatUIConfig.getModelOptions({ engine, model: '', reasoning: '', permissionMode: '' }),
  ]),
)

/** 兼容旧 modelLabel 签名：经切片解析展示名（dyn 为动态 supportedModels 投影）。 */
export function modelLabel(agent: string, value: string, dyn?: { value: string; displayName: string; description?: string }[] | null): string {
  const slice = SLICES[agent as Engine]
  if (!slice) return value
  const opts = dyn ? dyn.map((m) => ({ value: m.value, label: m.displayName, description: m.description })) : null
  return slice.chatUIConfig.getModelLabel(value, opts)
}
