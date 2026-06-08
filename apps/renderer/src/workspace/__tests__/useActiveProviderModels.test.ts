import { describe, it, expect } from 'vitest'
import { pickActiveProviderModels, activeProviderDefaults } from '../useActiveProviderModels'
import type { ProvidersResp } from '../../api/types'

const resp = (active: string, models: { value: string; label: string }[]): ProvidersResp => ({
  engines: {
    claude: { active, providers: [{ id: 'p1', engine: 'claude', name: 'fox', baseUrl: 'b', keyEnv: 'auth_token', hasKey: true, maskedKey: '', sortIndex: 0, createdAt: 1, models, defaultModel: models[0]?.value, wireApi: 'responses' }] },
    codex: { active: 'default', providers: [] },
  },
})

describe('activeProviderDefaults', () => {
  it('active=自定义有 defaultModel → 收录', () => {
    expect(activeProviderDefaults(resp('p1', [{ value: 'relay-opus', label: 'R' }]))).toEqual({ claude: 'relay-opus' })
  })
  it('active=default → 不收录（让 seedModel 回落）', () => {
    expect(activeProviderDefaults(resp('default', []))).toEqual({})
  })
})

describe('pickActiveProviderModels', () => {
  it('active=default → 空数组（前端回落引擎官方）', () => {
    expect(pickActiveProviderModels(resp('default', [{ value: 'x', label: 'X' }]), 'claude')).toEqual([])
  })
  it('active=自定义 → 该 Provider 的 models（value+label）', () => {
    expect(pickActiveProviderModels(resp('p1', [{ value: 'relay-opus', label: 'Relay Opus' }]), 'claude'))
      .toEqual([{ value: 'relay-opus', label: 'Relay Opus' }])
  })
})
