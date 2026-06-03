import type Database from 'better-sqlite3'
import type { RecordUsageInput, UsageRow } from './types'

interface UsageDbRow {
  id: number; session_id: string; turn: number
  input_tokens: number; output_tokens: number; cost_usd: number | null; created_at: number
}
const toRow = (r: UsageDbRow): UsageRow => ({
  id: r.id, sessionId: r.session_id, turn: r.turn,
  inputTokens: r.input_tokens, outputTokens: r.output_tokens, costUsd: r.cost_usd, createdAt: r.created_at,
})

export function recordUsage(db: Database.Database, input: RecordUsageInput): void {
  db.prepare('INSERT INTO usage (session_id, turn, input_tokens, output_tokens, cost_usd, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(input.sessionId, input.turn, input.inputTokens, input.outputTokens, input.costUsd ?? null, Date.now())
}

export function sumUsage(db: Database.Database, sessionId: string): { inputTokens: number; outputTokens: number; costUsd: number } {
  const r = db.prepare('SELECT COALESCE(SUM(input_tokens),0) i, COALESCE(SUM(output_tokens),0) o, COALESCE(SUM(cost_usd),0) c FROM usage WHERE session_id = ?').get(sessionId) as { i: number; o: number; c: number }
  return { inputTokens: r.i, outputTokens: r.o, costUsd: Math.round(r.c * 1e9) / 1e9 }
}

/** 按会话取用量，插入顺序（rowid）。 */
export function getUsage(db: Database.Database, sessionId: string): UsageRow[] {
  const rows = db.prepare('SELECT * FROM usage WHERE session_id = ? ORDER BY rowid').all(sessionId) as UsageDbRow[]
  return rows.map(toRow)
}
