import { describe, it, expect } from 'vitest'
import { detectClaudeLoginFromFiles } from '../claudeLoginDetect'

describe('detectClaudeLoginFromFiles', () => {
  it('OAuth 凭证 → signed-in + oauth（本地无 email，固定 undefined）', () => {
    const r = detectClaudeLoginFromFiles({
      '.credentials.json': JSON.stringify({
        claudeAiOauth: { accessToken: 'sk-ant-oat-x', expiresAt: Date.now() + 1e6 },
      }),
    })
    expect(r).toEqual({ status: 'signed-in', method: 'oauth', email: undefined })
  })

  it('api key 凭证 → signed-in + api_key', () => {
    const r = detectClaudeLoginFromFiles({
      '.credentials.json': JSON.stringify({ apiKey: 'sk-ant-api-x' }),
    })
    expect(r).toEqual({ status: 'signed-in', method: 'api_key' })
  })

  it('无凭证文件 → signed-out', () => {
    expect(detectClaudeLoginFromFiles({})).toEqual({ status: 'signed-out' })
  })

  it('JSON 解析失败 → signed-out（检测绝不抛）', () => {
    expect(detectClaudeLoginFromFiles({ '.credentials.json': 'not-json' })).toEqual({
      status: 'signed-out',
    })
  })

  it('既无 oauth 又无 apiKey → signed-out', () => {
    expect(
      detectClaudeLoginFromFiles({ '.credentials.json': JSON.stringify({ organizationUuid: 'x' }) }),
    ).toEqual({ status: 'signed-out' })
  })
})
