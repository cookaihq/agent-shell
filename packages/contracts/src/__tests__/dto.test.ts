import { describe, it, expect } from 'vitest'
import { CreateProjectReq, CreateProjectRes, CreateSessionReq, CreateSessionRes, SubmitMessageReq, ResumeReq, ApiError } from '../dto'
import { CreateProviderReq, UpdateProviderReq, SetActiveProviderReq, ProviderKeyEnv } from '../dto'
import { SkillGroupDef, AddGroupReq, PatchGroupReq, ReorderGroupsReq, SkillSourceDef, AppConfig } from '../dto'

describe('dto', () => {
  it('CreateSessionReq 绑定 projectId/engine/model，title 可选', () => {
    expect(CreateSessionReq.parse({ projectId: 'p1', engine: 'claude', model: 'opus' }))
      .toEqual({ projectId: 'p1', engine: 'claude', model: 'opus' })
    expect(CreateSessionReq.parse({ projectId: 'p1', engine: 'codex', model: 'gpt-5', title: '改登录' }))
      .toMatchObject({ title: '改登录' })
    expect(() => CreateSessionReq.parse({ engine: 'claude', model: 'opus' })).toThrow()  // 缺 projectId
    expect(() => CreateSessionReq.parse({ projectId: 'p1', engine: 'gemini', model: 'x' })).toThrow()  // 非法引擎
  })

  it('CreateProjectReq 只需 name；skills 省略=undefined（保留 undefined/[] 区分供注入默认集判定）；Res 回 projectId+path', () => {
    expect(CreateProjectReq.parse({ name: '我的项目' })).toEqual({ name: '我的项目' })  // 省略 skills → 不带该键（undefined），建项目据此注入默认集
    expect(CreateProjectReq.parse({ name: '项目', skills: ['guizang-ppt'] })).toEqual({ name: '项目', skills: ['guizang-ppt'] })
    expect(CreateProjectRes.parse({ projectId: 'abc', path: '/x/abc' })).toMatchObject({ projectId: 'abc' })
  })

  it('SubmitMessageReq：text 必填，contextFiles 默认空', () => {
    expect(SubmitMessageReq.parse({ text: 'hi' })).toEqual({ text: 'hi', contextFiles: [] })
  })

  it('SubmitMessageReq：activeFile 可选透传，缺省不出现', () => {
    expect(SubmitMessageReq.parse({ text: 'hi', activeFile: 'src/a.ts' }))
      .toEqual({ text: 'hi', contextFiles: [], activeFile: 'src/a.ts' })
    // 缺省 → nullish 不进结果，旧断言不破
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

describe('skill groups', () => {
  it('SkillGroupDef：id/name 必填，sortIndex 默认 0', () => {
    expect(SkillGroupDef.parse({ id: 'g_1', name: '推荐技能' })).toEqual({ id: 'g_1', name: '推荐技能', sortIndex: 0 })
  })
  it('AddGroupReq 只要 name；PatchGroupReq name 可选；ReorderGroupsReq 是 id 数组', () => {
    expect(AddGroupReq.parse({ name: 'X' })).toEqual({ name: 'X' })
    expect(PatchGroupReq.parse({})).toEqual({})
    expect(PatchGroupReq.parse({ name: 'Y' })).toEqual({ name: 'Y' })
    expect(ReorderGroupsReq.parse({ order: ['g_1', 'g_2'] })).toEqual({ order: ['g_1', 'g_2'] })
  })
  it('SkillSourceDef.groupId 可选（旧数据无 groupId 也能解析，迁移回填）', () => {
    const old = { id: 's_1', type: 'git', name: 'x', loc: 'github.com/a/b' }
    const parsed = SkillSourceDef.parse(old)
    expect(parsed.groupId).toBeUndefined()
    const withG = SkillSourceDef.parse({ ...old, groupId: 'g_1' })
    expect(withG.groupId).toBe('g_1')
  })
  it('AppConfig 接受两个播种标记（可选 bool）', () => {
    const c = AppConfig.parse({ projectsDir: '/p', skillsDir: '/s', automationsDir: '/a', seededRecommendedGroup: true, seededDefaultSecrets: true })
    expect(c.seededRecommendedGroup).toBe(true)
    expect(c.seededDefaultSecrets).toBe(true)
  })
})
