import { describe, it, expect } from 'vitest'
import { openDatabase } from '../database'
import { appendMessage, getMessages } from '../messages'

describe('messages repo', () => {
  it('追加消息 → 内容块 JSON 往返无损', () => {
    const db = openDatabase(':memory:')
    const blocks = [{ type: 'text', text: 'hi' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { command: 'ls' } }]
    const m = appendMessage(db, { sessionId: 's1', role: 'assistant', blocks })
    expect(m.id).toMatch(/[0-9a-f-]{36}/)
    const got = getMessages(db, 's1')
    expect(got).toHaveLength(1)
    expect(got[0].blocks).toEqual(blocks)
    expect(got[0]).toMatchObject({ sessionId: 's1', role: 'assistant' })
    db.close()
  })

  it('按 session 过滤 + 插入顺序（rowid）', () => {
    const db = openDatabase(':memory:')
    appendMessage(db, { sessionId: 's1', role: 'user', blocks: [{ type: 'text', text: 'first' }] })
    appendMessage(db, { sessionId: 's2', role: 'user', blocks: [{ type: 'text', text: 'other' }] })
    appendMessage(db, { sessionId: 's1', role: 'assistant', blocks: [{ type: 'text', text: 'second' }] })
    expect(getMessages(db, 's1').map((m) => (m.blocks[0] as any).text)).toEqual(['first', 'second'])
    db.close()
  })

  it('无消息 → 空数组', () => {
    const db = openDatabase(':memory:')
    expect(getMessages(db, 'empty')).toEqual([])
    db.close()
  })
})
