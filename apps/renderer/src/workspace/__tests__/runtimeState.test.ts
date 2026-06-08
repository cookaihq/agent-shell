import { describe, it, expect, beforeEach } from 'vitest'
import {
  CLI_MODELS,
  AGENT_LABEL,
  RISK_COLOR,
  initialRuntime,
  runtimeReducer,
  modelLabel,
  saveLastRuntime,
  type RuntimeState,
} from '../runtimeState'

beforeEach(() => {
  // 投影 bag 持久化在 localStorage，逐用例清空避免互染
  localStorage.clear()
})

describe('中立常量', () => {
  it('CLI_MODELS 含 claude SDK 别名/变体 + codex（value/label 形态）', () => {
    expect(CLI_MODELS.claude.map((m) => m.value)).toEqual(expect.arrayContaining(['default', 'sonnet', 'haiku', 'opus', 'opus[1m]']))
    expect(CLI_MODELS.claude.find((m) => m.value === 'opus[1m]')?.label).toBe('Opus 1M')
    expect(CLI_MODELS.codex.map((m) => m.value)).toEqual(expect.arrayContaining(['gpt-5.5', 'gpt-5.4-mini']))   // 真实 codex slug
  })

  it('AGENT_LABEL 映射', () => {
    expect(AGENT_LABEL.claude).toBe('Claude Code')
    expect(AGENT_LABEL.codex).toBe('Codex CLI')
  })

  it('RISK_COLOR 4 键（中立风险枚举 → 色）', () => {
    expect(RISK_COLOR.low).toBe('var(--green)')
    expect(RISK_COLOR.high).toBe('var(--red)')
    expect(RISK_COLOR.ask).toBe('var(--amber)')
    expect(RISK_COLOR.mid).toBe('var(--blue)')
  })
})

describe('initialRuntime（中立槽）', () => {
  it('已知 model（SDK 别名）直接用', () => {
    const rt = initialRuntime('claude', 'opus')
    expect(rt.engine).toBe('claude')
    expect(rt.model).toBe('opus')   // 'opus' 在 claude 列表 value 里，保留不洗
  })

  it('非静态 model（旧显示名或自定义 Provider model）→ 信任传入，不再回退（P2）', () => {
    // 新语义：传入非空 model 一律保留（来自会话 DB 或 active provider 种子）
    const rt = initialRuntime('claude', 'Claude Opus 4.8')
    expect(rt.model).toBe('Claude Opus 4.8')
  })

  it('claude 初始中立槽', () => {
    const rt = initialRuntime('claude', 'opus')
    expect(rt.permissionMode).toBe('default')
    expect(rt.reasoning).toBe('high')
  })

  it('codex 初始中立槽（modeSelections 承载审批/沙箱）', () => {
    const rt = initialRuntime('codex', 'gpt-5.5')
    expect(rt.engine).toBe('codex')
    expect(rt.model).toBe('gpt-5.5')
    expect(rt.reasoning).toBe('medium')
    expect(rt.modeSelections).toEqual({ approval: 'on-request', sandbox: 'workspace-write' })
  })

  it('会话 init 回填（DB 存的 permissionMode/effort 最高优先）', () => {
    const rt = initialRuntime('claude', 'opus', { permissionMode: 'plan', effort: 'max' })
    expect(rt.permissionMode).toBe('plan')
    expect(rt.reasoning).toBe('max')
  })
})

describe('runtimeReducer（中立 action）', () => {
  it('SET_AGENT 切 agent，model 若不在新列表则回退', () => {
    const rt = initialRuntime('claude', 'opus')
    const next = runtimeReducer(rt, { type: 'SET_AGENT', agent: 'codex' })
    expect(next.engine).toBe('codex')
    expect(next.model).toBe(CLI_MODELS.codex[0].value)  // claude 模型不在 codex 列表，回退首个
  })

  it('SET_MODEL 直接替换', () => {
    const rt = initialRuntime('claude', 'opus')
    const next = runtimeReducer(rt, { type: 'SET_MODEL', model: 'sonnet' })
    expect(next.model).toBe('sonnet')
  })

  it('SET_PERMISSION_MODE 切权限档（中立槽）', () => {
    const rt = initialRuntime('claude', 'opus')
    const next = runtimeReducer(rt, { type: 'SET_PERMISSION_MODE', permissionMode: 'plan' })
    expect(next.permissionMode).toBe('plan')
  })

  it('SET_MODE_SELECTION 写 codex approval/sandbox 槽', () => {
    const rt = initialRuntime('codex', 'gpt-5.5')
    const a = runtimeReducer(rt, { type: 'SET_MODE_SELECTION', slot: 'approval', value: 'never' })
    expect(a.modeSelections?.approval).toBe('never')
    const b = runtimeReducer(a, { type: 'SET_MODE_SELECTION', slot: 'sandbox', value: 'danger-full-access' })
    expect(b.modeSelections?.sandbox).toBe('danger-full-access')
    expect(b.modeSelections?.approval).toBe('never')  // 另一槽不变
  })

  it('SET_REASONING 切 effort（中立槽）', () => {
    const rt = initialRuntime('claude', 'opus')
    const next = runtimeReducer(rt, { type: 'SET_REASONING', reasoning: 'xhigh' })
    expect(next.reasoning).toBe('xhigh')
  })
})

describe('per-agent 投影 bag（Issue 13：切 CLI 复用上次档位）', () => {
  it('切 codex → 调档 → 切回 claude → 再切回 codex，复用 codex 上次档位', () => {
    // claude 起步，改 permissionMode/reasoning
    let rt: RuntimeState = initialRuntime('claude', 'opus')
    rt = runtimeReducer(rt, { type: 'SET_PERMISSION_MODE', permissionMode: 'bypassPermissions' })
    rt = runtimeReducer(rt, { type: 'SET_REASONING', reasoning: 'max' })
    // 切 codex，改其档位
    rt = runtimeReducer(rt, { type: 'SET_AGENT', agent: 'codex' })
    rt = runtimeReducer(rt, { type: 'SET_MODE_SELECTION', slot: 'approval', value: 'never' })
    rt = runtimeReducer(rt, { type: 'SET_REASONING', reasoning: 'high' })
    rt = runtimeReducer(rt, { type: 'SET_MODEL', model: 'gpt-5.4' })
    // 切回 claude → 应复用 claude 上次（bypass/max/opus）
    rt = runtimeReducer(rt, { type: 'SET_AGENT', agent: 'claude' })
    expect(rt.permissionMode).toBe('bypassPermissions')
    expect(rt.reasoning).toBe('max')
    expect(rt.model).toBe('opus')
    // 再切回 codex → 应复用 codex 上次（never/high/gpt-5.4）
    rt = runtimeReducer(rt, { type: 'SET_AGENT', agent: 'codex' })
    expect(rt.modeSelections?.approval).toBe('never')
    expect(rt.reasoning).toBe('high')
    expect(rt.model).toBe('gpt-5.4')
  })

  it('saveLastRuntime 把投影 bag 落 localStorage，新 initialRuntime 读回上次值', () => {
    let rt: RuntimeState = initialRuntime('claude', 'opus')
    rt = runtimeReducer(rt, { type: 'SET_PERMISSION_MODE', permissionMode: 'acceptEdits' })
    rt = runtimeReducer(rt, { type: 'SET_REASONING', reasoning: 'low' })
    saveLastRuntime(rt)
    // 模拟新会话/新进程：再开一个 claude 会话（无 init），应复用上次 acceptEdits/low
    const fresh = initialRuntime('claude', 'opus')
    expect(fresh.permissionMode).toBe('acceptEdits')
    expect(fresh.reasoning).toBe('low')
  })
})

describe('initialRuntime model 信任传入值', () => {
  it('保留传入的非静态 model（自定义 Provider model 不被洗）', () => {
    expect(initialRuntime('claude', 'relay-opus').model).toBe('relay-opus')
  })
  it('传入空 model → 回落静态首项', () => {
    expect(initialRuntime('claude', '').model).toBe('default')
  })
})

describe('modelLabel（经切片解析展示名）', () => {
  it('claude 动态：选中 opus[1m] → Opus 1M（对齐后强制展示名，覆盖 SDK 给的 displayName）', () => {
    const dyn = [
      { value: 'default', displayName: 'Default (recommended)', description: '1M context' },
      { value: 'sonnet', displayName: 'Sonnet', description: 'Everyday' },
      { value: 'haiku', displayName: 'Haiku', description: 'Fast' },
      { value: 'opus[1m]', displayName: 'Opus (1M context)', description: 'Opus 4.8 · 1M context' },
    ]
    expect(modelLabel('claude', 'opus[1m]', dyn)).toBe('Opus 1M')
  })

  it('claude 静态兜底（dyn=null）：opus[1m] → Opus 1M', () => {
    expect(modelLabel('claude', 'opus[1m]', null)).toBe('Opus 1M')
  })

  it('claude 静态兜底：default → Default (recommended)', () => {
    expect(modelLabel('claude', 'default', null)).toBe('Default (recommended)')
  })

  it('查不到 → 回退 value 自身', () => {
    expect(modelLabel('claude', 'nonexistent', null)).toBe('nonexistent')
  })

  it('codex：真实 slug → 友好展示名（value=gpt-5.5 → label GPT 5.5）', () => {
    expect(modelLabel('codex', 'gpt-5.5', null)).toBe('GPT 5.5')
  })
})
