import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendRecord, readRecords, transcriptPath, transcriptToMessages } from '../transcript'

let dir: string
beforeEach(() => { dir = fs.mkdtempSync(path.join(os.tmpdir(), 'as-tr-')) })
afterEach(() => { fs.rmSync(dir, { recursive: true, force: true }) })

describe('transcript 模块', () => {
  it('appendRecord 套信封写一行；readRecords 往返', () => {
    appendRecord(dir, 's1', 'claude', 'user_prompt', { text: 'hi' }, () => 1000)
    appendRecord(dir, 's1', 'claude', 'assistant', { message: { id: 'msg_1' } }, () => 1001)
    const recs = readRecords(dir, 's1')
    expect(recs).toHaveLength(2)
    expect(recs[0]).toEqual({ ts: 1000, engine: 'claude', type: 'user_prompt', raw: { text: 'hi' } })
    expect((recs[1].raw as any).message.id).toBe('msg_1')
  })

  it('无文件 → 空数组', () => {
    expect(readRecords(dir, 'nope')).toEqual([])
  })

  it('跳过空行与坏行', () => {
    const f = transcriptPath(dir, 's2')
    fs.mkdirSync(dir, { recursive: true })
    fs.writeFileSync(f, '{"ts":1,"engine":"claude","type":"result","raw":{}}\n\n{bad json\n')
    const recs = readRecords(dir, 's2')
    expect(recs).toHaveLength(1)
    expect(recs[0].type).toBe('result')
  })
})

it('重组：user_prompt→user DTO；assistant 流→assistant DTO（含 msg_id）', () => {
  const recs = [
    { ts: 1, engine: 'claude' as const, type: 'user_prompt', raw: { text: '你好', attachments: [] } },
    { ts: 2, engine: 'claude' as const, type: 'assistant', raw: { type: 'assistant', message: { id: 'msg_9', content: [{ type: 'text', text: '你好呀' }] }, uuid: 'u9' } },
    { ts: 3, engine: 'claude' as const, type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: '你好呀' }] } },
    { ts: 4, engine: 'claude' as const, type: 'result', raw: { type: 'result', is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
  ]
  const msgs = transcriptToMessages('s1', recs)
  expect(msgs).toHaveLength(2)
  expect(msgs[0]).toMatchObject({ role: 'user', blocks: [{ type: 'text', text: '你好' }] })
  expect(msgs[1]).toMatchObject({ role: 'assistant', sdkMessageId: 'msg_9', sdkUuid: 'u9' })
  expect((msgs[1].blocks[0] as any)).toEqual({ type: 'text', text: '你好呀' })
  expect(msgs[0].id).toBe('s1#0')
  expect(msgs[1].id).toBe('s1#1')
})

it('重组：跳过 provider 回吐的 typed-prompt user 记录（带 promptSource）', () => {
  const recs = [
    { ts: 1, engine: 'claude' as const, type: 'user_prompt', raw: { text: 'q', attachments: [] } },
    { ts: 2, engine: 'claude' as const, type: 'user', raw: { type: 'user', promptSource: 'sdk', message: { role: 'user', content: [{ type: 'text', text: 'q' }] } } },
    { ts: 3, engine: 'claude' as const, type: 'assistant', raw: { type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'a' }] }, uuid: 'u' } },
    { ts: 4, engine: 'claude' as const, type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'a' }] } },
    { ts: 5, engine: 'claude' as const, type: 'result', raw: { type: 'result', is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
  ]
  const msgs = transcriptToMessages('s1', recs)
  expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
})

it('重组：codex assistant_blocks → assistant DTO（直接用 blocks）', () => {
  const recs = [
    { ts: 1, engine: 'codex' as const, type: 'user_prompt', raw: { text: 'q', attachments: [] } },
    { ts: 2, engine: 'codex' as const, type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'codex 答' }] } },
  ]
  const msgs = transcriptToMessages('s1', recs)
  expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
  expect(msgs[1].blocks).toEqual([{ type: 'text', text: 'codex 答' }])
})

it('重组：assistant_blocks 含 thinking 块 → 历史保留思考（历史===实时）', () => {
  const recs = [
    { ts: 1, engine: 'claude' as const, type: 'user_prompt', raw: { text: 'q', attachments: [] } },
    { ts: 2, engine: 'claude' as const, type: 'assistant', raw: { type: 'assistant', message: { id: 'm', content: [] }, uuid: 'u' } },
    { ts: 3, engine: 'claude' as const, type: 'assistant_blocks', raw: { blocks: [{ type: 'thinking', text: '推理过程', elapsedMs: 1200 }, { type: 'text', text: '答案' }] } },
  ]
  const msgs = transcriptToMessages('s1', recs)
  expect(msgs[1].blocks).toEqual([{ type: 'thinking', text: '推理过程', elapsedMs: 1200 }, { type: 'text', text: '答案' }])
  expect(msgs[1].sdkMessageId).toBe('m')
})
