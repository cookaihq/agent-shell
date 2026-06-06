import { describe, it, expect } from 'vitest'
import { SkillSourceDef, AddSourceReq, ProbedSkill, ToggleLibReq, UpdateMode } from '../dto'

describe('skill source contracts', () => {
  it('SkillSourceDef 默认 updateMode=manual / sortIndex=0', () => {
    const s = SkillSourceDef.parse({ id: 's1', type: 'git', name: 'a/b', loc: 'github.com/a/b' })
    expect(s.updateMode).toBe('manual'); expect(s.sortIndex).toBe(0)
  })
  it('AddSourceReq 不要 id（daemon 生成）', () => {
    expect(AddSourceReq.safeParse({ type: 'folder', name: 'x', loc: '/tmp/x' }).success).toBe(true)
    expect('id' in AddSourceReq.parse({ type: 'folder', name: 'x', loc: '/tmp/x' })).toBe(false)
  })
  it('ProbedSkill.globalIn 为引擎数组', () => {
    const p = ProbedSkill.parse({ sourceId: 's1', name: 'pdf', relPath: 'pdf/', desc: 'x', inLib: true, globalIn: ['claude'] })
    expect(p.globalIn).toEqual(['claude'])
  })
  it('ToggleLibReq 形状', () => {
    expect(ToggleLibReq.safeParse({ sourceId: 's1', relPath: 'pdf/', inLib: false }).success).toBe(true)
  })
  it('UpdateMode 三档', () => {
    expect(UpdateMode.options).toEqual(['manual', 'auto', 'autolib'])
  })
})
