import { describe, it, expect } from 'vitest'
import { CreateProviderReq, ProviderView } from '../dto'

describe('CreateProviderReq apiKeySecretId', () => {
  it('接受 apiKeySecretId（引用密钥库）', () => {
    const r = CreateProviderReq.safeParse({ engine: 'claude', name: 'X', baseUrl: 'https://api.x.com', apiKeySecretId: 'k_123', keyEnv: 'auth_token', models: [{ value: 'm', label: 'M' }], defaultModel: 'm' })
    expect(r.success).toBe(true)
  })
  it('仍接受裸 apiKey（兼容旧）', () => {
    const r = CreateProviderReq.safeParse({ engine: 'claude', name: 'X', baseUrl: 'https://api.x.com', apiKey: 'sk-x', keyEnv: 'api_key', models: [{ value: 'm', label: 'M' }], defaultModel: 'm' })
    expect(r.success).toBe(true)
  })
  it('ProviderView 暴露 apiKeySecretId（可空）', () => {
    const base = { id: 'p1', engine: 'claude', name: 'X', baseUrl: 'https://api.x.com', keyEnv: 'auth_token', hasKey: true, maskedKey: 'sk…1a2b', sortIndex: 0, createdAt: 1, models: [], wireApi: 'responses' }
    expect(ProviderView.safeParse({ ...base, apiKeySecretId: 'k_1' }).success).toBe(true)
    expect(ProviderView.safeParse(base).success).toBe(true)  // 省略也合法
  })
})
