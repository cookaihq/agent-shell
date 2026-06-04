import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseClaudeLine, parseClaudeObject, createClaudeParser, createClaudeObjectParser } from '../claude'
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

  it('tools fixture：最终 thinking 块为空被跳过 → [tool_use, tool_result, message, usage, turn_end]', () => {
    // 真实数据里最终 assistant 的 thinking 块是空串（真文本在 thinking_delta，由流式解析器累计）；
    // 非流式 parseClaudeLine 跳过空 thinking，不再产出空块。
    const ev = parseAll(fixture('claude/tools.jsonl'))
    expect(ev.map((e) => e.type)).toEqual(['tool_use', 'tool_result', 'message', 'usage', 'turn_end'])
    expect(ev[0]).toMatchObject({ type: 'tool_use', name: 'Bash' })
    expect((ev[0] as any).input.command).toBe('echo hi-from-fixture')
    expect(ev[1]).toMatchObject({ type: 'tool_result', ok: true, content: 'hi-from-fixture' })
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

  it('#6 result.modelUsage → usage.contextWindow 取最大（权威窗口替占位）', () => {
    const ev = parseClaudeLine('{"type":"result","subtype":"success","stop_reason":"end_turn","usage":{"input_tokens":5,"output_tokens":2},"modelUsage":{"claude-opus-4-8":{"contextWindow":1000000},"sub":{"contextWindow":200000}}}')
    expect(ev[0]).toMatchObject({ type: 'usage', contextWindow: 1000000 })
  })

  it('#8 result.structured_output → structured_output 事件（json_schema 通路）', () => {
    const ev = parseClaudeLine('{"type":"result","subtype":"success","stop_reason":"end_turn","usage":{"input_tokens":1,"output_tokens":1},"structured_output":{"title":"x","score":9}}')
    expect(ev.map((e) => e.type)).toEqual(['usage', 'structured_output', 'turn_end'])
    expect(ev[1]).toEqual({ type: 'structured_output', data: { title: 'x', score: 9 } })
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

  it('时间闸：token 涨不够 STEP，但距上次 ≥150ms 也发帧（保活，注入假时钟）', () => {
    let clock = 1000
    const parse = createClaudeParser(() => clock)
    // 起 text 块（首帧 keychange 发，lastEmitAt=1000，tokens=0）
    parse('{"type":"stream_event","event":{"type":"content_block_start","index":0,"content_block":{"type":"text"}}}')
    // 小增量 8 字符 → +2 token，不够 STEP(25) 且时间未推进 → 不发
    const noEmit = parse('{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"12345678"}}}')
    expect(noEmit.filter((e) => e.type === 'progress')).toHaveLength(0)
    // 再来同样小增量，但时间推进 150ms → 保活发一帧
    clock += 150
    const emit = parse('{"type":"stream_event","event":{"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"12345678"}}}')
    expect(emit.filter((e) => e.type === 'progress')).toHaveLength(1)
  })
})

// SDK runtime 复用同一套解析逻辑，但喂的是已 parse 的 SDKMessage 对象（非 JSONL 字符串）。
// createClaudeObjectParser 是对象级入口：字符串版本就是它 + JSON.parse 包一层。
describe('createClaudeObjectParser（SDK 消息对象级解析）', () => {
  it('assistant 对象的 text 被过滤（正文走 text_delta 逐字流式，去重）；tool_use 仍出', () => {
    const parse = createClaudeObjectParser()
    const out = parse({
      type: 'assistant',
      message: { content: [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }] },
    })
    // text 被去重过滤，只剩 tool_use
    expect(out).toEqual([{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a' } }])
  })

  it('text_delta 逐字流式：边收发 message(streaming:true)，content_block_stop 发 message(streaming:false) 定格', () => {
    const parse = createClaudeObjectParser(() => 1000)   // 固定时钟：节流闸恒过（t-0≥60）
    parse({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
    const d1 = parse({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '你好' } } })
    expect(d1).toContainEqual({ type: 'message', text: '你好', streaming: true })
    const stop = parse({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } })
    expect(stop).toContainEqual({ type: 'message', text: '你好', streaming: false })
  })

  it('result 对象（SDKResultMessage）→ usage + turn_end，字段名与 CLI result 行同（input_tokens/total_cost_usd）', () => {
    const parse = createClaudeObjectParser()
    const out = parse({
      type: 'result', subtype: 'success', is_error: false, stop_reason: 'end_turn',
      total_cost_usd: 0.5, usage: { input_tokens: 10, output_tokens: 3 },
    })
    expect(out.map((e) => e.type)).toEqual(['usage', 'turn_end'])
    expect(out[0]).toMatchObject({ type: 'usage', inputTokens: 10, outputTokens: 3, costUsd: 0.5 })
    expect(out[1]).toMatchObject({ type: 'turn_end', stopReason: 'end_turn' })
  })

  it('stream_event 对象（SDKPartialAssistantMessage）→ progress，跨调用累计（同 createClaudeParser）', () => {
    const parse = createClaudeObjectParser()
    const start = parse({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
    expect(start[0]).toMatchObject({ type: 'progress', activity: { kind: 'responding' } })
    const delta = parse({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'x'.repeat(100) } } })
    expect((delta.find((e) => e.type === 'progress') as any).tokens).toBe(25)
  })

  it('user 对象带 tool_result（SDKUserMessage）→ tool_result 事件', () => {
    const parse = createClaudeObjectParser()
    const out = parse({
      type: 'user',
      message: { content: [{ type: 'tool_result', tool_use_id: 't1', is_error: false, content: 'done' }] },
    })
    expect(out).toEqual([{ type: 'tool_result', toolUseId: 't1', ok: true, content: 'done' }])
  })

  it('result 对象后累计器重置（下一轮归零，同字符串版）', () => {
    const parse = createClaudeObjectParser()
    parse({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } })
    parse({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'x', estimated_tokens: 50 } } })
    parse({ type: 'result', subtype: 'success', stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } })
    const next = parse({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } })
    expect((next.find((e) => e.type === 'progress') as any).tokens).toBe(0)
  })

  it('未知/系统对象（system.init 等）→ 空数组，不抛', () => {
    const parse = createClaudeObjectParser()
    expect(parse({ type: 'system', subtype: 'init', session_id: 's1' })).toEqual([])
    expect(parse({ type: 'system', subtype: 'session_state_changed', state: 'idle' })).toEqual([])
  })

  // SDK streaming 下最终 assistant 的 thinking 块为空，真文本只在 thinking_delta → 累计后在 content_block_stop 发
  it('thinking 文本从 thinking_delta 累计、content_block_stop 时发 thinking 事件', () => {
    const parse = createClaudeObjectParser()
    parse({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } })
    parse({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '先分析' } } })
    parse({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '再决定' } } })
    const stop = parse({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } })
    expect(stop).toContainEqual(expect.objectContaining({ type: 'thinking', text: '先分析再决定' }))
  })

  // Issue 17：思考块带 elapsedMs（content_block_start → stop 的耗时，daemon 权威计时）
  it('thinking 事件带 elapsedMs（注入假时钟精确验证）', () => {
    let t = 1000
    const parse = createClaudeObjectParser(() => t)
    parse({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'thinking' } } })
    t = 1500
    parse({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: '想' } } })
    t = 4200   // 停止时 now=4200，起始=1000 → elapsedMs=3200
    const stop = parse({ type: 'stream_event', event: { type: 'content_block_stop', index: 0 } })
    expect(stop).toContainEqual({ type: 'thinking', text: '想', elapsedMs: 3200 })
  })

  it('最终 assistant：空 thinking 跳过 + text 过滤 → 空数组（thinking 走 delta、text 走 delta）', () => {
    const parse = createClaudeObjectParser()
    const out = parse({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '', signature: 'sig' }, { type: 'text', text: 'hi' }] } })
    expect(out).toEqual([])   // 空 thinking 不发 + text 去重过滤
  })

  it('非 streaming（最终 thinking 非空）仍发 thinking（兼容无 partial 场景）', () => {
    const parse = createClaudeObjectParser()
    const out = parse({ type: 'assistant', message: { content: [{ type: 'thinking', thinking: '完整思考' }] } })
    expect(out).toEqual([{ type: 'thinking', text: '完整思考' }])
  })
})

// 子代理数据链（spec §6）：parent_tool_use_id 归属透传 + 三类 system 生命周期消息 → subagent 事件 + 并发流隔离
describe('subagent 数据链：parent_tool_use_id 归属 + 生命周期 system 消息', () => {
  it('assistant 顶层 parent_tool_use_id → tool_use 块带 parentToolUseId（子代理消息归属）', () => {
    const out = parseClaudeObject({
      type: 'assistant', parent_tool_use_id: 'tu1',
      message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'a' } }] },
    })
    expect(out).toEqual([{ type: 'tool_use', id: 't2', name: 'Read', input: { file_path: 'a' }, parentToolUseId: 'tu1' }])
  })

  it('assistant 文本/思考块也带 parentToolUseId', () => {
    const out = parseClaudeObject({
      type: 'assistant', parent_tool_use_id: 'tu1',
      message: { content: [{ type: 'text', text: 'hi' }, { type: 'thinking', thinking: '想' }] },
    })
    expect(out).toContainEqual({ type: 'message', text: 'hi', parentToolUseId: 'tu1' })
    expect(out).toContainEqual({ type: 'thinking', text: '想', parentToolUseId: 'tu1' })
  })

  it('user tool_result 带 parentToolUseId（子代理工具回执归属）', () => {
    const out = parseClaudeObject({
      type: 'user', parent_tool_use_id: 'tu1',
      message: { content: [{ type: 'tool_result', tool_use_id: 't2', is_error: false, content: 'done' }] },
    })
    expect(out).toEqual([{ type: 'tool_result', toolUseId: 't2', ok: true, content: 'done', parentToolUseId: 'tu1' }])
  })

  it('parent_tool_use_id 为 null（主线）→ 不带 parentToolUseId（与现状同构）', () => {
    const out = parseClaudeObject({
      type: 'assistant', parent_tool_use_id: null,
      message: { content: [{ type: 'tool_use', id: 't2', name: 'Read', input: {} }] },
    })
    expect(out).toEqual([{ type: 'tool_use', id: 't2', name: 'Read', input: {} }])
  })

  it('system task_started → subagent(started)（带 subagentType/description/skipTranscript）', () => {
    const out = parseClaudeObject({
      type: 'system', subtype: 'task_started', task_id: 'tk1', tool_use_id: 'tu1',
      subagent_type: 'general-purpose', description: 'do x', skip_transcript: false,
    })
    expect(out).toEqual([{
      type: 'subagent', phase: 'started', taskId: 'tk1', toolUseId: 'tu1',
      subagentType: 'general-purpose', description: 'do x', skipTranscript: false,
    }])
    expect(() => AgentEvent.parse(out[0])).not.toThrow()
  })

  it('system task_progress → subagent(progress)（usage camelCase + lastToolName）', () => {
    const out = parseClaudeObject({
      type: 'system', subtype: 'task_progress', task_id: 'tk1', tool_use_id: 'tu1',
      subagent_type: 'general-purpose', description: 'do x',
      usage: { total_tokens: 120, tool_uses: 3, duration_ms: 4500 }, last_tool_name: 'Read', summary: 'reading',
    })
    expect(out).toEqual([{
      type: 'subagent', phase: 'progress', taskId: 'tk1', toolUseId: 'tu1',
      subagentType: 'general-purpose', description: 'do x', summary: 'reading',
      usage: { totalTokens: 120, toolUses: 3, durationMs: 4500 }, lastToolName: 'Read',
    }])
    expect(() => AgentEvent.parse(out[0])).not.toThrow()
  })

  it('system task_notification → subagent(ended)（status + 定格 usage）', () => {
    const out = parseClaudeObject({
      type: 'system', subtype: 'task_notification', task_id: 'tk1', tool_use_id: 'tu1',
      status: 'completed', usage: { total_tokens: 300, tool_uses: 5, duration_ms: 9000 }, summary: 'done', skip_transcript: true,
    })
    expect(out).toEqual([{
      type: 'subagent', phase: 'ended', taskId: 'tk1', toolUseId: 'tu1',
      status: 'completed', summary: 'done', skipTranscript: true,
      usage: { totalTokens: 300, toolUses: 5, durationMs: 9000 },
    }])
    expect(() => AgentEvent.parse(out[0])).not.toThrow()
  })

  it('task system 缺 task_id → 丢弃（无法归属）', () => {
    expect(parseClaudeObject({ type: 'system', subtype: 'task_started', tool_use_id: 'tu1' })).toEqual([])
  })

  it('parseClaudeLine 字符串通路同样解析子代理 system 消息', () => {
    const ev = parseClaudeLine('{"type":"system","subtype":"task_notification","task_id":"tk1","status":"failed"}')
    expect(ev).toEqual([{ type: 'subagent', phase: 'ended', taskId: 'tk1', status: 'failed' }])
  })

  it('流式 stream_event 顶层 parent_tool_use_id → message(streaming) 带 parentToolUseId', () => {
    const parse = createClaudeObjectParser(() => 1000)   // 固定时钟：节流闸恒过
    parse({ type: 'stream_event', parent_tool_use_id: 'A', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
    const d = parse({ type: 'stream_event', parent_tool_use_id: 'A', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '子代理输出' } } })
    expect(d).toContainEqual({ type: 'message', text: '子代理输出', streaming: true, parentToolUseId: 'A' })
  })

  it('并发子代理流：相同 block index 不串台（按 parent:index 命名空间化累计）', () => {
    let t = 1000
    const parse = createClaudeObjectParser(() => t)
    // 两个子代理 A/B 同时各起一个 index 0 的文本块
    parse({ type: 'stream_event', parent_tool_use_id: 'A', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
    parse({ type: 'stream_event', parent_tool_use_id: 'B', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
    t = 1100
    const a = parse({ type: 'stream_event', parent_tool_use_id: 'A', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'AAA' } } })
    t = 1200
    const b = parse({ type: 'stream_event', parent_tool_use_id: 'B', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'BBB' } } })
    expect(a).toContainEqual({ type: 'message', text: 'AAA', streaming: true, parentToolUseId: 'A' })
    expect(b).toContainEqual({ type: 'message', text: 'BBB', streaming: true, parentToolUseId: 'B' })   // 非 'AAABBB'
    // 块结束定格：各自只含自己的文本（若 key 撞了这里会串成混合文本）
    t = 1300
    const aStop = parse({ type: 'stream_event', parent_tool_use_id: 'A', event: { type: 'content_block_stop', index: 0 } })
    expect(aStop).toContainEqual({ type: 'message', text: 'AAA', streaming: false, parentToolUseId: 'A' })
  })

  it('主线流式（parent_tool_use_id 缺省）仍不带 parentToolUseId（向后兼容）', () => {
    const parse = createClaudeObjectParser(() => 1000)
    parse({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text' } } })
    const d = parse({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: '主线' } } })
    expect(d).toContainEqual({ type: 'message', text: '主线', streaming: true })
  })
})
