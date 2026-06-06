import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { appendRecord, readRecords, transcriptPath, collapseStreamingText } from '../transcript'

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

// 注（§8）：transcript 记录 → MessageDTO 的重建测试已迁移到 renderer 切片
// （apps/renderer/src/workspace/agents/__tests__/historyService.test.ts，claude/codex 切片各测）。
// daemon 本文件仅保留 transcript 模块 IO（append/read）+ collapseStreamingText 纯函数行为守护。

describe('collapseStreamingText（折叠流式前缀堆叠文本块）', () => {
  it('把同归属、前缀递增的相邻文本块折叠成最长那条', () => {
    const blocks = [
      { type: 'text', text: 'He' },
      { type: 'text', text: 'Hello' },
      { type: 'text', text: 'Hello' },
    ]
    expect(collapseStreamingText(blocks)).toEqual([{ type: 'text', text: 'Hello' }])
  })

  it('保留非前缀关系的相邻文本块（不误折）', () => {
    const blocks = [
      { type: 'text', text: '第一段独立内容' },
      { type: 'text', text: '完全不同的第二段' },
    ]
    expect(collapseStreamingText(blocks)).toEqual(blocks)
  })

  it('不同 parentToolUseId 不折叠（即便前缀关系）', () => {
    const blocks = [
      { type: 'text', text: 'He', parentToolUseId: 'a' },
      { type: 'text', text: 'Hello', parentToolUseId: 'b' },
    ]
    expect(collapseStreamingText(blocks)).toEqual(blocks)
  })

  it('被非文本块隔开的两段流式各自折叠、互不合并', () => {
    const blocks = [
      { type: 'text', text: 'Read' },
      { type: 'text', text: 'Reading file' },
      { type: 'tool_use', id: 't1', name: 'Read', input: {} },
      { type: 'text', text: 'Done' },
      { type: 'text', text: 'Done!' },
    ]
    expect(collapseStreamingText(blocks)).toEqual([
      { type: 'text', text: 'Reading file' },
      { type: 'tool_use', id: 't1', name: 'Read', input: {} },
      { type: 'text', text: 'Done!' },
    ])
  })

  it('已干净的块 = no-op（含 thinking/tool 不受影响）', () => {
    const blocks = [{ type: 'thinking', text: 't' }, { type: 'text', text: 'a' }, { type: 'tool_use', id: 'x', name: 'Bash', input: {} }]
    expect(collapseStreamingText(blocks)).toEqual(blocks)
  })

  it('折叠保留整个块对象的随行字段（parentToolUseId / skipTranscript 不裁剪）', () => {
    const blocks = [
      { type: 'text', text: 'I will', parentToolUseId: 'task-1' },
      { type: 'text', text: 'I will start', parentToolUseId: 'task-1' },
    ]
    // 保留最长那条「整块」——含 parentToolUseId（§8/§11#5 子代理嵌套依赖此字段不丢）
    expect(collapseStreamingText(blocks)).toEqual([{ type: 'text', text: 'I will start', parentToolUseId: 'task-1' }])
  })
})
