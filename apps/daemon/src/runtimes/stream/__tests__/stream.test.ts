import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseStream } from '../index'
import { AgentEvent } from '@agent-shell/contracts'

const dir = path.dirname(fileURLToPath(import.meta.url))
const fixture = (p: string) => fs.readFileSync(path.join(dir, '../__fixtures__', p), 'utf8')

describe('parseStream', () => {
  it('claude/tools 全链归一序列（最终空 thinking 块跳过）', () => {
    const ev = parseStream(fixture('claude/tools.jsonl'), 'claude')
    // tools.jsonl 最终 assistant 的 thinking 块为空串（真文本在 thinking_delta 流式累计）→ 跳过空块
    expect(ev.map((e) => e.type)).toEqual(['tool_use', 'tool_result', 'message', 'usage', 'turn_end'])
    ev.forEach((e) => expect(() => AgentEvent.parse(e)).not.toThrow())
  })

  it('codex/tools 全链归一序列', () => {
    const ev = parseStream(fixture('codex/tools.jsonl'), 'codex')
    expect(ev.map((e) => e.type)).toEqual(['tool_use', 'tool_result', 'message', 'usage', 'turn_end'])
  })

  it('坏帧夹在中间被跳过，不打断整条流', () => {
    const good = fixture('claude/text.jsonl').split('\n').filter((l) => l.trim())
    const mixed = [good[0], 'GARBAGE LINE', '{ broken json', good[1], good[2]].join('\n')
    const ev = parseStream(mixed, 'claude')
    expect(ev.map((e) => e.type)).toEqual(['message', 'usage', 'turn_end'])
  })

  it('空输入 → 空数组', () => {
    expect(parseStream('', 'claude')).toEqual([])
    expect(parseStream('\n\n', 'codex')).toEqual([])
  })
})
