import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseClaudeLine, createClaudeParser } from '../claude'
import { AgentEvent } from '@agent-shell/contracts'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fixture = (p: string) => fs.readFileSync(path.join(dir, '../__fixtures__', p), 'utf8')
const parseAll = (text: string) =>
  text.split('\n').filter((l) => l.trim()).flatMap((l) => parseClaudeLine(l))

describe('parseClaudeLine', () => {
  it('text fixture 归一为 [message, usage, turn_end]', () => {
    const ev = parseAll(fixture('claude/text.jsonl'))
    expect(ev.map((e) => e.type)).toEqual(['message', 'usage', 'turn_end'])
    expect(ev[0]).toMatchObject({ type: 'message', text: 'hello' })
    expect(ev[1]).toMatchObject({ type: 'usage', inputTokens: 6146, outputTokens: 4 })
    expect(ev[2]).toMatchObject({ type: 'turn_end', stopReason: 'end_turn' })
  })

  it('tools fixture 归一为 [thinking, tool_use, tool_result, message, usage, turn_end]', () => {
    const ev = parseAll(fixture('claude/tools.jsonl'))
    expect(ev.map((e) => e.type)).toEqual(['thinking', 'tool_use', 'tool_result', 'message', 'usage', 'turn_end'])
    expect(ev[1]).toMatchObject({ type: 'tool_use', name: 'Bash' })
    expect((ev[1] as any).input.command).toBe('echo hi-from-fixture')
    expect(ev[2]).toMatchObject({ type: 'tool_result', ok: true, content: 'hi-from-fixture' })
  })

  it('每个输出事件都符合 AgentEvent 契约', () => {
    for (const e of parseAll(fixture('claude/tools.jsonl'))) {
      expect(() => AgentEvent.parse(e)).not.toThrow()
    }
  })

  it('坏帧（非法 JSON / 未知事件）返回空数组，不抛', () => {
    expect(parseClaudeLine('not json')).toEqual([])
    expect(parseClaudeLine('{"type":"system","subtype":"init"}')).toEqual([])
    expect(parseClaudeLine('{"type":"rate_limit_event"}')).toEqual([])
  })

  it('result 的 total_cost_usd 为 null 时仍产出合法 usage（costUsd 省略）', () => {
    const ev = parseClaudeLine('{"type":"result","subtype":"success","stop_reason":"end_turn","total_cost_usd":null,"usage":{"input_tokens":5,"output_tokens":2}}')
    expect(ev.map((e) => e.type)).toEqual(['usage', 'turn_end'])
    expect(() => AgentEvent.parse(ev[0])).not.toThrow()
    expect((ev[0] as any).costUsd).toBeUndefined()
  })

  it('usage 事件带 costUsd（成功路径）', () => {
    const ev = parseAll(fixture('claude/text.jsonl'))
    expect((ev[1] as any).costUsd).toBeCloseTo(0.1775, 3)
  })

  it('缺字段的坏事件被丢弃（tool_use 无 id）', () => {
    const ev = parseClaudeLine('{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Bash","input":{}}]}}')
    expect(ev).toEqual([])
  })

  it('result is_error:true → turn_end(stopReason failed)：claude 失败仍出终结且标记失败，不被误判成功', () => {
    const ev = parseAll(fixture('claude/failed.jsonl'))
    expect(ev.map((e) => e.type)).toEqual(['usage', 'turn_end'])
    // is_error 时不取 stop_reason('stop_sequence' 看着像正常结束)，统一标 'failed'
    expect(ev[1]).toMatchObject({ type: 'turn_end', stopReason: 'failed' })
    expect(() => AgentEvent.parse(ev[1])).not.toThrow()
  })

  it('result is_error 缺省/为 false → 仍取 stop_reason（成功路径不受影响）', () => {
    const ok = parseClaudeLine('{"type":"result","subtype":"success","is_error":false,"stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1}}')
    expect(ok[1]).toMatchObject({ type: 'turn_end', stopReason: 'end_turn' })
  })

  it('result is_error → detail 取 result 文本（真因带到 UI，不静默吞掉）', () => {
    const ev = parseClaudeLine('{"type":"result","subtype":"error_during_execution","is_error":true,"result":"Credit balance is too low","usage":{"input_tokens":1,"output_tokens":0}}')
    expect(ev[1]).toMatchObject({ type: 'turn_end', stopReason: 'failed', detail: 'Credit balance is too low' })
  })

  it('result is_error 但无 result 文本 → detail 退回 subtype', () => {
    const ev = parseClaudeLine('{"type":"result","subtype":"error_max_turns","is_error":true,"usage":{"input_tokens":1,"output_tokens":0}}')
    expect(ev[1]).toMatchObject({ type: 'turn_end', stopReason: 'failed', detail: 'error_max_turns' })
  })
})

describe('createClaudeParser（流式 progress）', () => {
  const run = (text: string) => {
    const parse = createClaudeParser()
    return text.split('\n').filter((l) => l.trim()).flatMap((l) => parse(l))
  }

  it('thinking 块开始即发 progress(thinking)，并随 estimated_tokens 累计', () => {
    const ev = run(fixture('claude/partial.jsonl'))
    const prog = ev.filter((e) => e.type === 'progress') as Extract<typeof ev[number], { type: 'progress' }>[]
    // 第一个 progress 来自 content_block_start(thinking)
    expect(prog[0]).toMatchObject({ type: 'progress', tokens: 0, activity: { kind: 'thinking' } })
    // thinking_delta estimated_tokens:30 → 出现过 tokens===30 的 thinking 进度
    expect(prog.some((p) => p.activity.kind === 'thinking' && p.tokens === 30)).toBe(true)
  })

  it('工具块给出 progress(tool) 且 content_block_stop 后带 target', () => {
    const ev = run(fixture('claude/partial.jsonl'))
    const tool = ev.filter((e) => e.type === 'progress' && e.activity.kind === 'tool') as any[]
    expect(tool.length).toBeGreaterThan(0)
    expect(tool.at(-1).activity).toMatchObject({ kind: 'tool', tool: 'Read', target: 'styles.css' })
  })

  it('progress 都符合 AgentEvent 契约', () => {
    for (const e of run(fixture('claude/partial.jsonl'))) {
      expect(() => AgentEvent.parse(e)).not.toThrow()
    }
  })

  it('result 行仍照常产出 usage + turn_end（委托 parseClaudeLine 不变）', () => {
    const ev = run(fixture('claude/partial.jsonl'))
    expect(ev.map((e) => e.type)).toContain('usage')
    expect(ev.map((e) => e.type)).toContain('turn_end')
  })

  it('text_delta 按 chars/4 估算（无 estimated_tokens 字段）', () => {
    const parse = createClaudeParser()
    parse('{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text"}}}')
    // 100 字符 → +25 token，达阈值 → 发一帧
    const long = 'x'.repeat(100)
    const out = parse(`{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"${long}"}}}`)
    const p = out.find((e) => e.type === 'progress') as any
    expect(p).toMatchObject({ activity: { kind: 'responding' } })
    expect(p.tokens).toBe(25)
  })

  it('两个 parser 实例状态隔离（不串台）', () => {
    const a = createClaudeParser()
    const b = createClaudeParser()
    a('{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}}')
    a('{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"x","estimated_tokens":50}}}')
    const bOut = b('{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"thinking"}}}')
    const bp = bOut.find((e) => e.type === 'progress') as any
    expect(bp.tokens).toBe(0) // b 自己的累计器从 0 起，不受 a 影响
  })
})
