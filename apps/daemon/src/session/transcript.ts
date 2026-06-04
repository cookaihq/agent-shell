import fs from 'node:fs'
import path from 'node:path'
import type { Engine } from '@agent-shell/contracts'
import { channelDataDir } from '../paths'

/** 一条 transcript 记录（引擎中立信封 + 原始负载）。 */
export interface TranscriptRecord {
  ts: number
  engine: Engine
  type: string
  raw: unknown
}

/** 会话正文目录 = {channelDataDir}/sessions（与 app.sqlite 同处，随渠道隔离）。 */
export function sessionsDir(): string {
  return path.join(channelDataDir(), 'sessions')
}

export function transcriptPath(dir: string, sessionId: string): string {
  return path.join(dir, `${sessionId}.jsonl`)
}

/** 追加一条记录（套信封）。dir/now 注入便于测试。 */
export function appendRecord(
  dir: string,
  sessionId: string,
  engine: Engine,
  type: string,
  raw: unknown,
  now: () => number = () => Date.now(),
): void {
  const rec: TranscriptRecord = { ts: now(), engine, type, raw }
  fs.mkdirSync(dir, { recursive: true })
  fs.appendFileSync(transcriptPath(dir, sessionId), JSON.stringify(rec) + '\n')
}

/** 读全部记录；无文件→[]，坏行/空行跳过。 */
export function readRecords(dir: string, sessionId: string): TranscriptRecord[] {
  let text: string
  try { text = fs.readFileSync(transcriptPath(dir, sessionId), 'utf8') } catch { return [] }
  const out: TranscriptRecord[] = []
  for (const line of text.split('\n')) {
    const s = line.trim()
    if (!s) continue
    try { out.push(JSON.parse(s) as TranscriptRecord) } catch { /* 坏行跳过 */ }
  }
  return out
}

export interface TranscriptMessage {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  blocks: unknown[]
  createdAt: number
  sdkMessageId?: string
  sdkUuid?: string
}

/** transcript 记录 → 按回合的消息（DTO 形）。渲染源统一为 assistant_blocks（含真实 thinking）；
 *  claude 原始流记录仅用于提取本回合的 msg_id / uuid，不参与渲染，保证历史 === 实时。 */
export function transcriptToMessages(sessionId: string, records: TranscriptRecord[]): TranscriptMessage[] {
  const out: TranscriptMessage[] = []
  let ord = 0
  let pendingMsgId: string | undefined
  let pendingUuid: string | undefined
  for (const rec of records) {
    if (rec.type === 'user_prompt') {
      const r = (rec.raw ?? {}) as { text?: string; attachments?: { name: string; path: string }[] }
      const blocks: unknown[] = [{ type: 'text', text: r.text ?? '' }]
      if (r.attachments && r.attachments.length > 0) blocks.push({ type: 'attachments', files: r.attachments })
      out.push({ id: `${sessionId}#${ord++}`, sessionId, role: 'user', blocks, createdAt: rec.ts })
      continue
    }
    if (rec.type === 'assistant_blocks') {
      const r = (rec.raw ?? {}) as { blocks?: unknown[] }
      out.push({ id: `${sessionId}#${ord++}`, sessionId, role: 'assistant', blocks: r.blocks ?? [], createdAt: rec.ts, sdkMessageId: pendingMsgId, sdkUuid: pendingUuid })
      pendingMsgId = undefined; pendingUuid = undefined
      continue
    }
    // claude 原始流记录：仅用于取本回合 msg_id/uuid（不参与渲染）
    if (rec.engine === 'claude') {
      const raw = rec.raw as any
      if (raw?.type === 'assistant') {
        if (typeof raw.message?.id === 'string') pendingMsgId = raw.message.id
        if (typeof raw.uuid === 'string') pendingUuid = raw.uuid
      }
    }
  }
  return out
}
