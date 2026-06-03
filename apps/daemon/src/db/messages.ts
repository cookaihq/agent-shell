import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { AppendMessageInput, MessageRow } from './types'

interface MessageDbRow { id: string; session_id: string; role: string; blocks: string; created_at: number }
const toRow = (r: MessageDbRow): MessageRow => ({
  id: r.id, sessionId: r.session_id, role: r.role as MessageRow['role'],
  blocks: JSON.parse(r.blocks) as unknown[], createdAt: r.created_at,
})

export function appendMessage(db: Database.Database, input: AppendMessageInput): MessageRow {
  const row: MessageRow = { id: randomUUID(), sessionId: input.sessionId, role: input.role, blocks: input.blocks, createdAt: Date.now() }
  db.prepare('INSERT INTO messages (id, session_id, role, blocks, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(row.id, row.sessionId, row.role, JSON.stringify(row.blocks), row.createdAt)
  return row
}

/** 按会话取消息，插入顺序（rowid）。 */
export function getMessages(db: Database.Database, sessionId: string): MessageRow[] {
  const rows = db.prepare('SELECT * FROM messages WHERE session_id = ? ORDER BY rowid').all(sessionId) as MessageDbRow[]
  return rows.map(toRow)
}
