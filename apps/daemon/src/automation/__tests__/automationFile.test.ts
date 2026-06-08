import { describe, it, expect } from 'vitest'
import { parseAutomationMd, serializeAutomationMd } from '../automationFile'

const SAMPLE = `---
name: 每日竞品监控
engine: claude
model: opus
permission: bypassPermissions
category: [运营, 监控]
tags: [紧急, 实验性]
requires:
  - { kind: env, name: COMPETITOR_API_KEY }
triggers:
  - kind: startup
  - kind: daily
    time: "09:00"
    timezone: Asia/Shanghai
target:
  mode: create_each_run
---
抓竞品动态生成简报。
`

describe('parseAutomationMd', () => {
  it('解析 frontmatter 定义 + 正文 prompt', () => {
    const { frontmatter, prompt } = parseAutomationMd(SAMPLE)
    expect(frontmatter.name).toBe('每日竞品监控')
    expect(frontmatter.engine).toBe('claude')
    expect(frontmatter.category).toEqual(['运营', '监控'])
    expect(frontmatter.tags).toEqual(['紧急', '实验性'])
    expect(frontmatter.requires).toEqual([{ kind: 'env', name: 'COMPETITOR_API_KEY' }])
    expect(frontmatter.triggers).toEqual([
      { kind: 'startup' },
      { kind: 'daily', time: '09:00', timezone: 'Asia/Shanghai' },
    ])
    expect(frontmatter.executor).toBe('agent') // 缺省
    expect(frontmatter.target).toEqual({ mode: 'create_each_run' })
    expect(prompt).toBe('抓竞品动态生成简报。')
  })

  it('无 frontmatter 或 schema 非法 → 抛错', () => {
    expect(() => parseAutomationMd('没有 frontmatter 的正文')).toThrow()
    expect(() => parseAutomationMd('---\nname: x\n---\n正文')).toThrow() // 缺 engine/triggers 等必填
    // triggers 为空数组 → 违反 .min(1)，非法
    expect(() => parseAutomationMd('---\nname: x\nengine: claude\nmodel: opus\npermission: p\ntriggers: []\ntarget:\n  mode: create_each_run\n---\n正文')).toThrow()
  })

  it('round-trip：serialize 后再 parse 等价（保留 description / executor=script）', () => {
    const fm = {
      name: 'n', description: '说明', engine: 'codex' as const, model: 'gpt-5.5',
      permission: 'workspace-write', category: ['运营'], tags: ['a'],
      requires: [{ kind: 'env' as const, name: 'TOKEN' }],
      triggers: [
        { kind: 'startup' as const },
        { kind: 'weekly' as const, time: '10:00', timezone: 'UTC', weekday: 1 },
      ],
      executor: 'script' as const, script: 'scan.mjs', interpreter: 'node',
      target: { mode: 'reuse' as const, projectId: 'p1' },
    }
    const md = serializeAutomationMd(fm, '正文指令')
    const again = parseAutomationMd(md)
    expect(again.frontmatter).toEqual(fm)
    expect(again.prompt).toBe('正文指令')
  })
})
