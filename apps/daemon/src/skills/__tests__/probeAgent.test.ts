import { describe, it, expect } from 'vitest'
import { agentProbeSlots } from '../probeAgent'

// 假 query：返回 async generator，吐一条 assistant 消息（文本含 ```json fenced 块）+ 一条 result。
function fakeQuery(finalText: string) {
  return () => (async function* () {
    yield { type: 'assistant', message: { content: [{ type: 'text', text: finalText }] } } as never
    yield { type: 'result', subtype: 'success', result: finalText } as never
  })()
}

describe('agentProbeSlots', () => {
  it('解析末轮 fenced JSON → ReqSlot[]', async () => {
    const text = '分析完毕。\n```json\n[{"kind":"env","name":"GAODE_API_KEY","optional":false}]\n```'
    const slots = await agentProbeSlots({ skillDir: '/tmp/x', queryFn: fakeQuery(text) })
    expect(slots).toEqual([{ kind: 'env', name: 'GAODE_API_KEY', bind: null, optional: false }])
  })
  it('空数组（技能无需配置）→ []', async () => {
    const slots = await agentProbeSlots({ skillDir: '/tmp/x', queryFn: fakeQuery('```json\n[]\n```') })
    expect(slots).toEqual([])
  })
  it('丢弃不合法项（缺 name / kind 非法），保留合法项', async () => {
    const text = '```json\n[{"kind":"env"},{"kind":"bogus","name":"X"},{"kind":"file","name":"~/.aws/credentials","fileMode":"external-path"}]\n```'
    const slots = await agentProbeSlots({ skillDir: '/tmp/x', queryFn: fakeQuery(text) })
    expect(slots).toEqual([{ kind: 'file', name: '~/.aws/credentials', fileMode: 'external-path', bind: null, optional: false }])
  })
  it('无 fenced JSON → []（解析失败不抛）', async () => {
    const slots = await agentProbeSlots({ skillDir: '/tmp/x', queryFn: fakeQuery('我看不懂这个技能。') })
    expect(slots).toEqual([])
  })
  it('取最后一个 fenced json 块（容多块）', async () => {
    const text = '```json\n[{"kind":"env","name":"OLD"}]\n```\n再想想：\n```json\n[{"kind":"env","name":"NEW","optional":true}]\n```'
    const slots = await agentProbeSlots({ skillDir: '/tmp/x', queryFn: fakeQuery(text) })
    expect(slots).toEqual([{ kind: 'env', name: 'NEW', bind: null, optional: true }])
  })
})
