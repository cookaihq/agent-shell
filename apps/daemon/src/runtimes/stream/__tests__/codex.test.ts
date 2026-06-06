import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseCodexLine } from '../codex'
import { AgentEvent } from '@agent-shell/contracts'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fixture = (p: string) => fs.readFileSync(path.join(dir, '../__fixtures__', p), 'utf8')
const parseAll = (text: string) =>
  text.split('\n').filter((l) => l.trim()).flatMap((l) => parseCodexLine(l))

describe('parseCodexLine', () => {
  it('text fixture 归一为 [message, usage, turn_end]', () => {
    const ev = parseAll(fixture('codex/text.jsonl'))
    expect(ev.map((e) => e.type)).toEqual(['message', 'usage', 'turn_end'])
    expect(ev[0]).toMatchObject({ type: 'message', text: 'hello' })
    expect(ev[1]).toMatchObject({ type: 'usage', inputTokens: 19983, outputTokens: 148 })
    expect(ev[2]).toMatchObject({ type: 'turn_end', stopReason: 'completed' })
  })

  it('tools fixture 归一为 [tool_use, tool_result, message, usage, turn_end]', () => {
    const ev = parseAll(fixture('codex/tools.jsonl'))
    expect(ev.map((e) => e.type)).toEqual(['tool_use', 'tool_result', 'message', 'usage', 'turn_end'])
    expect(ev[0]).toMatchObject({ type: 'tool_use', name: 'shell' })
    expect((ev[0] as any).input.command).toContain('echo hi-from-codex')
    expect(ev[1]).toMatchObject({ type: 'tool_result', ok: true, content: 'hi-from-codex\n' })
  })

  it('每个输出事件都符合 AgentEvent 契约', () => {
    for (const e of parseAll(fixture('codex/tools.jsonl'))) {
      expect(() => AgentEvent.parse(e)).not.toThrow()
    }
  })

  it('坏帧（非法 JSON / 忽略类事件）返回空数组，不抛', () => {
    expect(parseCodexLine('{oops')).toEqual([])
    expect(parseCodexLine('{"type":"thread.started","thread_id":"x"}')).toEqual([])
    expect(parseCodexLine('{"type":"turn.started"}')).toEqual([])
  })

  it('缺字段的坏事件被丢弃（command_execution 无 id）', () => {
    expect(parseCodexLine('{"type":"item.started","item":{"type":"command_execution","command":"x"}}')).toEqual([])
  })

  // ── 中立 tool 字段（§11#1）─────────────────────────────────────────────────
  it('command_execution item.started 发出 tool_use：tool="bash"，name="shell"，input.command 保留', () => {
    const ev = parseCodexLine('{"type":"item.started","item":{"type":"command_execution","id":"c1","command":"echo hi"}}')
    expect(ev).toHaveLength(1)
    expect(ev[0]).toMatchObject({ type: 'tool_use', id: 'c1', name: 'shell', input: { command: 'echo hi' }, tool: 'bash' })
  })

  it('非零退出码映射为 tool_result.ok=false（失败语义）', () => {
    const ev = parseCodexLine('{"type":"item.completed","item":{"id":"item_9","type":"command_execution","command":"false","exit_code":1,"aggregated_output":"boom"}}')
    expect(ev).toEqual([{ type: 'tool_result', toolUseId: 'item_9', ok: false, content: 'boom' }])
  })

  it('turn.failed → turn_end(stopReason failed)，error 行被忽略', () => {
    const failed = JSON.stringify({ type: 'turn.failed', error: { message: 'unexpected status 503' } })
    expect(parseCodexLine(failed)).toEqual([{ type: 'turn_end', stopReason: 'failed' }])
    expect(parseCodexLine(JSON.stringify({ type: 'error', message: 'Reconnecting... 1/5' }))).toEqual([])
  })

  it('failed fixture 全链：thread/turn.started/error 忽略，仅末尾 turn_end(failed)', () => {
    const text = fixture('codex/failed.jsonl')
    const ev = text.split('\n').filter((l) => l.trim()).flatMap((l) => parseCodexLine(l))
    expect(ev.map((e) => e.type)).toEqual(['turn_end'])
    expect(ev[0]).toMatchObject({ type: 'turn_end', stopReason: 'failed' })
  })
})
