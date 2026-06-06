import type { TranscriptRecord } from '@agent-shell/contracts'
import type { MessageDTO } from '../../../api/types'
import { rebuildShared } from '../historyShared'

/**
 * codex 切片历史重建（§8）：仅共享骨架（user_prompt + assistant_blocks）。
 *
 * codex 不发原始 assistant 流记录、无 msg_id 概念 → 不挂任何切片钩子（共享骨架已足）。
 */
export function codexRebuildBlocks(records: TranscriptRecord[]): MessageDTO[] {
  return rebuildShared(records)
}
