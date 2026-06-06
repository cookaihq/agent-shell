import fs from 'node:fs'
import path from 'node:path'
import type { Engine } from '@agent-shell/contracts'
import { collapseStreamingText } from '@agent-shell/contracts'
import type { TranscriptRecord } from '@agent-shell/contracts'
import { channelDataDir } from '../paths'

// TranscriptRecord 与 collapseStreamingText 已下沉 @agent-shell/contracts（renderer 切片 historyService 重建复用同一份）。
// daemon 这里 re-export，让本模块及现有引用方（sessionRuntime onTurnEnd 落库前折叠、测试）无需改 import 来源。
export type { TranscriptRecord }
export { collapseStreamingText }

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

// §8：transcript 记录 → MessageDTO 的重建职责已整体下沉 renderer 各切片 historyService.rebuildBlocks
// （claude 切片含 msg_id 提取、codex 切片仅共享骨架），daemon 不再保留 transcriptToMessages / TranscriptMessage。
// collapseStreamingText 仍在本模块 re-export 供 onTurnEnd 落库前折叠（§13 勿丢），且共享自 contracts。
