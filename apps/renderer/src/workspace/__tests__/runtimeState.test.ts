import { describe, it, expect } from 'vitest'
import {
  CLI_MODELS,
  CLAUDE_MODES,
  CODEX_APPROVAL,
  CODEX_SANDBOX,
  EFFORTS,
  AGENT_LABEL,
  CLAUDE_SHORT,
  APPROVAL_SHORT,
  SANDBOX_SHORT,
  CLAUDE_RISK,
  CODEX_RISK,
  RISK_COLOR,
  initialRuntime,
  chipPerm,
  chipEffort,
  runtimeReducer,
} from '../runtimeState'

describe('常量 1:1 移植', () => {
  it('CLI_MODELS 包含 claude/codex', () => {
    expect(CLI_MODELS.claude).toContain('Claude Opus 4.8')
    expect(CLI_MODELS.claude).toContain('Claude Sonnet 4.6')
    expect(CLI_MODELS.codex).toContain('GPT 5.5')
    expect(CLI_MODELS.codex).toContain('GPT 5.4 Mini')
  })

  it('CLAUDE_MODES 5 个，含 id/zh/en', () => {
    expect(CLAUDE_MODES).toHaveLength(5)
    const ids = CLAUDE_MODES.map(m => m.id)
    expect(ids).toContain('default')
    expect(ids).toContain('bypassPermissions')
    expect(CLAUDE_MODES[0]).toMatchObject({ id: 'default', zh: '改动前都问', en: 'Ask before edits' })
  })

  it('CODEX_APPROVAL 3 个，含 id/zh/en', () => {
    expect(CODEX_APPROVAL).toHaveLength(3)
    expect(CODEX_APPROVAL[0]).toMatchObject({ id: 'untrusted', zh: '仅受信命令', en: 'Untrusted' })
    expect(CODEX_APPROVAL[1]).toMatchObject({ id: 'on-request', zh: '按需询问', en: 'On request' })
  })

  it('CODEX_SANDBOX 3 个，含 id/zh/en', () => {
    expect(CODEX_SANDBOX).toHaveLength(3)
    expect(CODEX_SANDBOX[0]).toMatchObject({ id: 'read-only', zh: '只读', en: 'Read only' })
    expect(CODEX_SANDBOX[2]).toMatchObject({ id: 'danger-full-access', zh: '完全访问', en: 'Full access' })
  })

  it('EFFORTS.claude 5 个，EFFORTS.codex 5 个', () => {
    expect(EFFORTS.claude).toHaveLength(5)
    expect(EFFORTS.codex).toHaveLength(5)
    expect(EFFORTS.claude[0]).toMatchObject({ id: 'low', zh: '低', en: 'Low' })
    expect(EFFORTS.claude[4]).toMatchObject({ id: 'ultra', zh: '超量', en: 'Ultra' })
    expect(EFFORTS.codex[0]).toMatchObject({ id: 'minimal', zh: '最小', en: 'Minimal' })
    expect(EFFORTS.codex[4]).toMatchObject({ id: 'xhigh', zh: '极高', en: 'xHigh' })
  })

  it('AGENT_LABEL 映射', () => {
    expect(AGENT_LABEL.claude).toBe('Claude Code')
    expect(AGENT_LABEL.codex).toBe('Codex CLI')
  })

  it('CLAUDE_SHORT 5 键', () => {
    expect(CLAUDE_SHORT.default).toBe('询问')
    expect(CLAUDE_SHORT.bypassPermissions).toBe('绕过')
  })

  it('APPROVAL_SHORT 3 键', () => {
    expect(APPROVAL_SHORT['on-request']).toBe('按需')
    expect(APPROVAL_SHORT.never).toBe('从不')
  })

  it('SANDBOX_SHORT 3 键', () => {
    expect(SANDBOX_SHORT['read-only']).toBe('只读')
    expect(SANDBOX_SHORT['danger-full-access']).toBe('完全')
  })

  it('CLAUDE_RISK 5 键', () => {
    expect(CLAUDE_RISK.default).toBe('ask')
    expect(CLAUDE_RISK.bypassPermissions).toBe('high')
  })

  it('CODEX_RISK 3 键', () => {
    expect(CODEX_RISK['read-only']).toBe('low')
    expect(CODEX_RISK['danger-full-access']).toBe('high')
  })

  it('RISK_COLOR 4 键', () => {
    expect(RISK_COLOR.low).toBe('var(--green)')
    expect(RISK_COLOR.high).toBe('var(--red)')
    expect(RISK_COLOR.ask).toBe('var(--amber)')
    expect(RISK_COLOR.mid).toBe('var(--blue)')
  })
})

describe('initialRuntime', () => {
  it('已知 model 直接用', () => {
    const rt = initialRuntime('claude', 'Claude Opus 4.8')
    expect(rt.agent).toBe('claude')
    expect(rt.model).toBe('Claude Opus 4.8')
  })

  it('未知 model 回退到列表第一个（syncRuntime L215 逻辑）', () => {
    const rt = initialRuntime('claude', 'opus')  // 'opus' 不在 CLI_MODELS.claude 里
    expect(rt.model).toBe(CLI_MODELS.claude[0])
  })

  it('codex 引擎初始态', () => {
    const rt = initialRuntime('codex', 'GPT 5.5')
    expect(rt.agent).toBe('codex')
    expect(rt.model).toBe('GPT 5.5')
    expect(rt.claudeMode).toBe('default')
    expect(rt.codexApproval).toBe('on-request')
    expect(rt.codexSandbox).toBe('workspace-write')
    expect(rt.effort.claude).toBe('high')
    expect(rt.effort.codex).toBe('medium')
  })
})

describe('chipPerm', () => {
  it('claude default → {text:"询问", risk:"ask"}', () => {
    const rt = initialRuntime('claude', 'Claude Opus 4.8')
    expect(chipPerm(rt)).toEqual({ text: '询问', risk: 'ask' })
  })

  it('claude bypassPermissions → {text:"绕过", risk:"high"}', () => {
    const rt = { ...initialRuntime('claude', 'Claude Opus 4.8'), claudeMode: 'bypassPermissions' as const }
    expect(chipPerm(rt)).toEqual({ text: '绕过', risk: 'high' })
  })

  it('codex on-request × workspace-write → 按需·工作区 mid', () => {
    const rt = initialRuntime('codex', 'GPT 5.5')
    const perm = chipPerm(rt)
    expect(perm?.text).toBe('按需·工作区')
    expect(perm?.risk).toBe('mid')
  })

  it('codex never × danger-full-access → 从不·完全 high', () => {
    const rt = {
      ...initialRuntime('codex', 'GPT 5.5'),
      codexApproval: 'never' as const,
      codexSandbox: 'danger-full-access' as const,
    }
    expect(chipPerm(rt)).toEqual({ text: '从不·完全', risk: 'high' })
  })
})

describe('chipEffort', () => {
  it('claude high → "高"', () => {
    const rt = initialRuntime('claude', 'Claude Opus 4.8')
    expect(chipEffort(rt)).toBe('高')
  })

  it('codex medium → "中"', () => {
    const rt = initialRuntime('codex', 'GPT 5.5')
    expect(chipEffort(rt)).toBe('中')
  })

  it('极端值 ultra → "超量"', () => {
    const rt = { ...initialRuntime('claude', 'Claude Opus 4.8'), effort: { claude: 'ultra' as const, codex: 'medium' as const } }
    expect(chipEffort(rt)).toBe('超量')
  })
})

describe('runtimeReducer', () => {
  it('SET_AGENT 切 agent，model 若不在新列表则回退', () => {
    const rt = initialRuntime('claude', 'Claude Opus 4.8')
    const next = runtimeReducer(rt, { type: 'SET_AGENT', agent: 'codex' })
    expect(next.agent).toBe('codex')
    // Claude Opus 4.8 不在 codex 列表，应该回退到 codex[0]
    expect(next.model).toBe(CLI_MODELS.codex[0])
  })

  it('SET_MODEL 直接替换', () => {
    const rt = initialRuntime('claude', 'Claude Opus 4.8')
    const next = runtimeReducer(rt, { type: 'SET_MODEL', model: 'Claude Sonnet 4.6' })
    expect(next.model).toBe('Claude Sonnet 4.6')
  })

  it('SET_CLAUDE_MODE', () => {
    const rt = initialRuntime('claude', 'Claude Opus 4.8')
    const next = runtimeReducer(rt, { type: 'SET_CLAUDE_MODE', claudeMode: 'auto' })
    expect(next.claudeMode).toBe('auto')
  })

  it('SET_CODEX_APPROVAL', () => {
    const rt = initialRuntime('codex', 'GPT 5.5')
    const next = runtimeReducer(rt, { type: 'SET_CODEX_APPROVAL', codexApproval: 'never' })
    expect(next.codexApproval).toBe('never')
  })

  it('SET_CODEX_SANDBOX', () => {
    const rt = initialRuntime('codex', 'GPT 5.5')
    const next = runtimeReducer(rt, { type: 'SET_CODEX_SANDBOX', codexSandbox: 'danger-full-access' })
    expect(next.codexSandbox).toBe('danger-full-access')
  })

  it('SET_EFFORT 按 agent 更新对应档位', () => {
    const rt = initialRuntime('claude', 'Claude Opus 4.8')
    const next = runtimeReducer(rt, { type: 'SET_EFFORT', agent: 'claude', effortId: 'ultra' })
    expect(next.effort.claude).toBe('ultra')
    expect(next.effort.codex).toBe('medium') // codex 不变
  })
})
