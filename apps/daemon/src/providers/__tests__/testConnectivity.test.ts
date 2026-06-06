import { describe, it, expect } from 'vitest'
import { testClaudeProvider } from '../testConnectivity'
import type { ClaudeQueryFn } from '../../runtimes/claudeSdk'

// 假 query：产出一条 assistant 文本（含 model 字段） + success result，立即结束
const okQuery: ClaudeQueryFn = () => (async function* () {
  yield { type: 'assistant', message: { model: 'claude-haiku-4-5-20251001', content: [{ type: 'text', text: 'Hey there!' }] } } as any
  yield { type: 'result', subtype: 'success', is_error: false, result: 'Hey there!' } as any
})() as any

const errQuery: ClaudeQueryFn = () => (async function* () {
  yield { type: 'result', subtype: 'error', is_error: true, result: 'Invalid token' } as any
})() as any

describe('testClaudeProvider', () => {
  it('成功 → ok + 回复文本 + 请求摘要（key 掩码）', async () => {
    const r = await testClaudeProvider({ baseUrl: 'https://relay', apiKey: 'sk-abcd1234', keyEnv: 'auth_token' }, { queryFn: okQuery, model: 'sonnet' })
    expect(r.ok).toBe(true)
    expect(r.responseText).toContain('Hey there!')
    expect(r.requestText).toContain('ANTHROPIC_AUTH_TOKEN=sk-…1234')
    expect(r.requestText).not.toContain('sk-abcd1234')
    // 请求摘要包含请求模型
    expect(r.requestText).toContain('model=sonnet')
    // 响应包含上游实际模型
    expect(r.responseText).toContain('claude-haiku-4-5-20251001')
  })
  it('上游错误 → ok=false + 错误体', async () => {
    const r = await testClaudeProvider({ baseUrl: 'https://relay', apiKey: 'sk-bad', keyEnv: 'api_key' }, { queryFn: errQuery })
    expect(r.ok).toBe(false)
    expect(r.responseText).toContain('Invalid token')
  })
  it('model 未传（undefined）→ requestText 包含 model=haiku（回落到廉价探针）', async () => {
    const r = await testClaudeProvider({ baseUrl: 'https://relay', apiKey: 'sk-abcd1234', keyEnv: 'auth_token' }, { queryFn: okQuery })
    expect(r.requestText).toContain('model=haiku')
  })
  it('model=default → requestText 包含 model=haiku（回落到廉价探针）', async () => {
    const r = await testClaudeProvider({ baseUrl: 'https://relay', apiKey: 'sk-abcd1234', keyEnv: 'auth_token' }, { queryFn: okQuery, model: 'default' })
    expect(r.requestText).toContain('model=haiku')
  })
  it('多 text 块 → 合并全部文本（不丢块）', async () => {
    const multiQuery: ClaudeQueryFn = () => (async function* () {
      yield { type: 'assistant', message: { model: 'claude-sonnet-4-5', content: [{ type: 'text', text: 'Part1 ' }, { type: 'text', text: 'Part2' }] } } as any
      yield { type: 'result', subtype: 'success', is_error: false, result: 'ok' } as any
    })() as any
    const r = await testClaudeProvider({ baseUrl: 'https://relay', apiKey: 'sk-xyz12345', keyEnv: 'api_key' }, { queryFn: multiQuery })
    expect(r.ok).toBe(true)
    expect(r.responseText).toContain('Part1 Part2')
  })
})
