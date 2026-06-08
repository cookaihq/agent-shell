import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { mapAppServerEvent } from '../eventMap'
import { AgentEvent } from '@agent-shell/contracts'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fixtureLines = (p: string) =>
  fs
    .readFileSync(path.join(dir, '../__fixtures__', p), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as { method?: string; params?: any })

/** 从某 fixture 取第一条匹配 (method, item.type) 的 notification，原样喂给 mapper。 */
const findNotif = (
  file: string,
  method: string,
  pred?: (params: any) => boolean,
) => {
  const m = fixtureLines(file).find(
    (o) => o.method === method && (!pred || pred(o.params)),
  )
  if (!m) throw new Error(`fixture ${file} 无 ${method} 通知`)
  return m as { method: string; params: any }
}
const mapNotif = (o: { method: string; params: any }) =>
  mapAppServerEvent(o.method, o.params)

describe('mapAppServerEvent — app-server v2 通知 → AgentEvent 纯映射', () => {
  it('agentMessage item/completed → message（完整全文）', () => {
    const o = findNotif(
      'basic-conversation.jsonl',
      'item/completed',
      (p) => p?.item?.type === 'agentMessage',
    )
    const ev = mapNotif(o)
    expect(ev).toEqual([
      { type: 'message', text: '我会创建目标文件，然后用只读命令核对内容确实只有这一行。' },
    ])
  })

  it('agentMessage item/started → 不发（避免空消息；正文走 completed）', () => {
    const o = findNotif(
      'basic-conversation.jsonl',
      'item/started',
      (p) => p?.item?.type === 'agentMessage',
    )
    expect(mapNotif(o)).toEqual([])
  })

  it('commandExecution item/started → tool_use(shell/bash, input.command)', () => {
    const o = findNotif(
      'basic-conversation.jsonl',
      'item/started',
      (p) => p?.item?.type === 'commandExecution',
    )
    const ev = mapNotif(o)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({
      type: 'tool_use',
      id: o.params.item.id,
      name: 'shell',
      tool: 'bash',
    })
    expect((ev[0] as any).input.command).toBe(o.params.item.command)
  })

  it('commandExecution item/completed → tool_result(ok=exitCode===0, content=aggregatedOutput)', () => {
    const o = findNotif(
      'basic-conversation.jsonl',
      'item/completed',
      (p) => p?.item?.type === 'commandExecution',
    )
    const ev = mapNotif(o)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({
      type: 'tool_result',
      toolUseId: o.params.item.id,
      ok: o.params.item.exitCode === 0,
    })
    expect((ev[0] as any).content).toBe(o.params.item.aggregatedOutput)
  })

  it('reasoning item/completed（summary/content 为空）→ 不发 thinking（空文本跳过）', () => {
    const o = findNotif(
      'basic-conversation.jsonl',
      'item/completed',
      (p) => p?.item?.type === 'reasoning',
    )
    // basic fixture 的 reasoning summary/content 均为空数组 → 无可显示文本 → []
    expect(mapNotif(o)).toEqual([])
  })

  it('reasoning 含文本 → thinking（合成 fixture 缺失文本态，按 baseline shape 防御映射）', () => {
    const ev = mapAppServerEvent('item/completed', {
      threadId: 't',
      turnId: 'u',
      item: {
        type: 'reasoning',
        id: 'rs_x',
        summary: ['先读 SKILL.md', '再创建文件'],
        content: [],
      },
    })
    expect(ev).toEqual([{ type: 'thinking', text: '先读 SKILL.md\n再创建文件' }])
  })

  it('userMessage（回显自己输入）→ 忽略', () => {
    const started = findNotif(
      'basic-conversation.jsonl',
      'item/started',
      (p) => p?.item?.type === 'userMessage',
    )
    const completed = findNotif(
      'basic-conversation.jsonl',
      'item/completed',
      (p) => p?.item?.type === 'userMessage',
    )
    expect(mapNotif(started)).toEqual([])
    expect(mapNotif(completed)).toEqual([])
  })

  it('turn/completed（status=completed）→ turn_end(completed)', () => {
    const o = findNotif('basic-conversation.jsonl', 'turn/completed')
    expect(o.params.turn.status).toBe('completed')
    expect(mapNotif(o)).toEqual([{ type: 'turn_end', stopReason: 'completed' }])
  })

  it('turn/completed（status=interrupted，来自 interrupt fixture）→ turn_end(interrupted)', () => {
    const o = findNotif('interrupt.jsonl', 'turn/completed')
    expect(o.params.turn.status).toBe('interrupted')
    expect(mapNotif(o)).toEqual([{ type: 'turn_end', stopReason: 'interrupted' }])
  })

  it('turn/completed 不读 usage（usage 实测 undefined）→ 只发 turn_end', () => {
    const o = findNotif('basic-conversation.jsonl', 'turn/completed')
    expect(mapNotif(o).some((e) => e.type === 'usage')).toBe(false)
  })

  it('thread/tokenUsage/updated → usage（真实字段名 tokenUsage.total.*）', () => {
    const o = findNotif('basic-conversation.jsonl', 'thread/tokenUsage/updated')
    const total = o.params.tokenUsage.total
    const ev = mapNotif(o)
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({
      type: 'usage',
      inputTokens: total.inputTokens,
      outputTokens: total.outputTokens,
      contextTokens: total.inputTokens,
      contextWindow: o.params.tokenUsage.modelContextWindow,
      contextWindowIsAuthoritative: true,
    })
  })

  it('error 通知 willRetry=true → 瞬态、忽略', () => {
    const ev = mapAppServerEvent('error', {
      error: { message: 'Reconnecting', codexErrorInfo: null, additionalDetails: null },
      willRetry: true,
      threadId: 't',
      turnId: 'u',
    })
    expect(ev).toEqual([])
  })

  it('error 通知 willRetry=false → turn_end(failed, detail)', () => {
    const ev = mapAppServerEvent('error', {
      error: { message: '上游连接失败', codexErrorInfo: null, additionalDetails: null },
      willRetry: false,
      threadId: 't',
      turnId: 'u',
    })
    expect(ev).toEqual([{ type: 'turn_end', stopReason: 'failed', detail: '上游连接失败' }])
  })

  it('turn/completed（status=failed）→ turn_end(failed, detail 来自 turn.error.message)', () => {
    const ev = mapAppServerEvent('turn/completed', {
      threadId: 't',
      turn: {
        id: 'u',
        status: 'failed',
        error: { message: '执行失败', codexErrorInfo: null, additionalDetails: null },
      },
    })
    expect(ev).toEqual([{ type: 'turn_end', stopReason: 'failed', detail: '执行失败' }])
  })

  it('fileChange item/started → tool_use(apply_patch/edit)（按 baseline shape 防御映射）', () => {
    const ev = mapAppServerEvent('item/started', {
      threadId: 't',
      turnId: 'u',
      item: {
        type: 'fileChange',
        id: 'fc_1',
        status: 'inProgress',
        changes: [{ path: '/tmp/a.txt', kind: 'add', diff: '+hi' }],
      },
    })
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ type: 'tool_use', id: 'fc_1', name: 'apply_patch', tool: 'edit' })
    expect((ev[0] as any).input.changes).toHaveLength(1)
  })

  it('fileChange item/completed → tool_result(ok=status===completed)', () => {
    const ok = mapAppServerEvent('item/completed', {
      threadId: 't',
      turnId: 'u',
      item: { type: 'fileChange', id: 'fc_1', status: 'completed', changes: [] },
    })
    expect(ok).toEqual([{ type: 'tool_result', toolUseId: 'fc_1', ok: true, content: '' }])

    const declined = mapAppServerEvent('item/completed', {
      threadId: 't',
      turnId: 'u',
      item: { type: 'fileChange', id: 'fc_2', status: 'declined', changes: [] },
    })
    expect(declined[0]).toMatchObject({ type: 'tool_result', toolUseId: 'fc_2', ok: false })
  })

  it('未知 method → []（防御，不抛）', () => {
    expect(mapAppServerEvent('thread/status/changed', { threadId: 't', status: { type: 'idle' } })).toEqual([])
    expect(mapAppServerEvent('account/rateLimits/updated', { rateLimits: {} })).toEqual([])
    expect(mapAppServerEvent('mcpServer/startupStatus/updated', {})).toEqual([])
    expect(mapAppServerEvent('某个未来新增方法', { foo: 1 })).toEqual([])
  })

  it('未知 item.type → []（防御，不抛）', () => {
    expect(
      mapAppServerEvent('item/completed', {
        threadId: 't',
        turnId: 'u',
        item: { type: '未来某新工具', id: 'x' },
      }),
    ).toEqual([])
    expect(
      mapAppServerEvent('item/started', { threadId: 't', turnId: 'u', item: { type: 'collabAgentToolCall', id: 'x' } }),
    ).toEqual([])
  })

  it('item 通知缺 params/item → []（不崩）', () => {
    expect(mapAppServerEvent('item/started', undefined as any)).toEqual([])
    expect(mapAppServerEvent('item/completed', {})).toEqual([])
    expect(mapAppServerEvent('item/completed', { item: null })).toEqual([])
  })

  it('item/agentMessage/delta（流式增量）→ 不在此处处理（3.3 负责累计）', () => {
    const o = findNotif('basic-conversation.jsonl', 'item/agentMessage/delta')
    expect(mapNotif(o)).toEqual([])
  })

  it('所有产出事件都符合 AgentEvent 契约', () => {
    const all = [
      ...fixtureLines('basic-conversation.jsonl'),
      ...fixtureLines('sandbox-readonly.jsonl'),
      ...fixtureLines('interrupt.jsonl'),
    ]
      .filter((o) => o.method)
      .flatMap((o) => mapAppServerEvent(o.method!, o.params))
    for (const ev of all) {
      expect(AgentEvent.safeParse(ev).success).toBe(true)
    }
    // 至少映射出了非空事件，证明 fixture 真的走通了映射
    expect(all.length).toBeGreaterThan(0)
  })
})
