import { describe, it, expect } from 'vitest'
import { ProviderModel, CreateProviderReq, UpdateProviderReq, ProviderView, ProviderWireApi, AppConfig } from '../dto'

describe('Provider DTO with models', () => {
  it('ProviderModel 需要 value + label', () => {
    expect(ProviderModel.safeParse({ value: 'opus', label: 'Opus' }).success).toBe(true)
    expect(ProviderModel.safeParse({ value: '', label: 'x' }).success).toBe(false)
  })

  it('CreateProviderReq.models 缺省为空数组、可带 defaultModel', () => {
    const r = CreateProviderReq.parse({ engine: 'codex', name: 'relay', baseUrl: 'https://x', apiKey: 'k' })
    expect(r.models).toEqual([])
    const r2 = CreateProviderReq.parse({ engine: 'codex', name: 'relay', baseUrl: 'https://x', apiKey: 'k', models: [{ value: 'gpt-5.5', label: 'GPT 5.5' }], defaultModel: 'gpt-5.5' })
    expect(r2.defaultModel).toBe('gpt-5.5')
  })

  it('UpdateProviderReq.models 可选', () => {
    expect(UpdateProviderReq.parse({}).models).toBeUndefined()
    expect(UpdateProviderReq.parse({ models: [], defaultModel: '' }).models).toEqual([])
  })

  it('ProviderView.models 缺省为空数组', () => {
    const v = ProviderView.parse({ id: 'p1', engine: 'claude', name: 'n', baseUrl: 'b', keyEnv: 'api_key', hasKey: true, maskedKey: 'sk-…1', sortIndex: 0, createdAt: 1 })
    expect(v.models).toEqual([])
  })
})

describe('Provider wireApi', () => {
  it('wireApi 枚举 chat|responses，缺省 responses', () => {
    expect(ProviderWireApi.parse(undefined)).toBe('responses')
    expect(CreateProviderReq.parse({ engine: 'codex', name: 'r', baseUrl: 'b', apiKey: 'k' }).wireApi).toBe('responses')
  })
})

describe('AppConfig.modelAliases', () => {
  it('AppConfig.modelAliases 可选、engine→model→别名', () => {
    const c = AppConfig.parse({ projectsDir: 'a', skillsDir: 'b', automationsDir: 'c', modelAliases: { claude: { 'claude-opus-4-8': '主力' } } })
    expect(c.modelAliases?.claude?.['claude-opus-4-8']).toBe('主力')
  })
})
