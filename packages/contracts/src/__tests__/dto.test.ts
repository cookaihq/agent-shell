import { describe, it, expect } from 'vitest'
import { CreateProjectReq, CreateProjectRes, CreateSessionReq, CreateSessionRes, SubmitMessageReq, ResumeReq, ApiError } from '../dto'
import { CreateProviderReq, UpdateProviderReq, SetActiveProviderReq, ProviderKeyEnv } from '../dto'

describe('dto', () => {
  it('CreateSessionReq 绑定 projectId/engine/model，title 可选', () => {
    expect(CreateSessionReq.parse({ projectId: 'p1', engine: 'claude', model: 'opus' }))
      .toEqual({ projectId: 'p1', engine: 'claude', model: 'opus' })
    expect(CreateSessionReq.parse({ projectId: 'p1', engine: 'codex', model: 'gpt-5', title: '改登录' }))
      .toMatchObject({ title: '改登录' })
    expect(() => CreateSessionReq.parse({ engine: 'claude', model: 'opus' })).toThrow()  // 缺 projectId
    expect(() => CreateSessionReq.parse({ projectId: 'p1', engine: 'gemini', model: 'x' })).toThrow()  // 非法引擎
  })

  it('CreateProjectReq 只需 name；skills 默认空数组；Res 回 projectId+path', () => {
    expect(CreateProjectReq.parse({ name: '我的项目' })).toEqual({ name: '我的项目', skills: [] })
    expect(CreateProjectReq.parse({ name: '项目', skills: ['guizang-ppt'] })).toEqual({ name: '项目', skills: ['guizang-ppt'] })
    expect(CreateProjectRes.parse({ projectId: 'abc', path: '/x/abc' })).toMatchObject({ projectId: 'abc' })
  })

  it('SubmitMessageReq：text 必填，contextFiles 默认空', () => {
    expect(SubmitMessageReq.parse({ text: 'hi' })).toEqual({ text: 'hi', contextFiles: [] })
  })

  it('ResumeReq：带一条续接 user 文本', () => {
    expect(ResumeReq.parse({ text: '继续' })).toEqual({ text: '继续' })
  })

  it('CreateSessionRes', () => {
    expect(CreateSessionRes.parse({ sessionId: 's1' })).toEqual({ sessionId: 's1' })
  })

  it('ApiError 形状不变', () => {
    expect(ApiError.parse({ error: { code: 'x', message: 'y' } })).toMatchObject({ error: { code: 'x' } })
  })
})

describe('provider dto', () => {
  it('ProviderKeyEnv 仅 api_key / auth_token', () => {
    expect(ProviderKeyEnv.parse('auth_token')).toBe('auth_token')
    expect(() => ProviderKeyEnv.parse('bearer')).toThrow()
  })
  it('CreateProviderReq 必填 engine/name/baseUrl/apiKey；keyEnv 默认 api_key', () => {
    expect(CreateProviderReq.parse({ engine: 'claude', name: '中转', baseUrl: 'https://x', apiKey: 'sk-1' }))
      .toMatchObject({ keyEnv: 'api_key' })
    expect(() => CreateProviderReq.parse({ engine: 'claude', name: '中转', apiKey: 'sk-1' })).toThrow()
  })
  it('SetActiveProviderReq 绑定 engine + providerId', () => {
    expect(SetActiveProviderReq.parse({ engine: 'claude', providerId: 'default' }))
      .toEqual({ engine: 'claude', providerId: 'default' })
  })
  it('UpdateProviderReq: apiKey 省略/空串均通过，name 空串被拒', () => {
    expect(() => UpdateProviderReq.parse({})).not.toThrow()
    expect(() => UpdateProviderReq.parse({ apiKey: '' })).not.toThrow()
    expect(() => UpdateProviderReq.parse({ name: '' })).toThrow()
  })
})
