import type { TranscriptRecord } from '@agent-shell/contracts'
import type { MessageDTO } from '../../../api/types'
import { rebuildShared } from '../historyShared'

/**
 * claude 切片历史重建（§8）：共享骨架 + claude 私有的 msg_id/uuid 提取。
 *
 * claude 原始 `assistant` 流记录不参与渲染，仅用于取本回合的 message.id / uuid，挂到随后那条
 * assistant_blocks 重建出的 assistant 消息（sdkMessageId / sdkUuid）→ 保证历史 === 实时（这是
 * 重构前 daemon transcriptToMessages 的唯一 per-agent 分支，现归 claude 切片）。
 */
export function claudeRebuildBlocks(records: TranscriptRecord[]): MessageDTO[] {
  let pendingMsgId: string | undefined
  let pendingUuid: string | undefined
  return rebuildShared(records, {
    onRecord: (rec) => {
      if (rec.engine !== 'claude') return
      const raw = rec.raw as { type?: string; message?: { id?: unknown }; uuid?: unknown }
      if (raw?.type === 'assistant') {
        if (typeof raw.message?.id === 'string') pendingMsgId = raw.message.id
        if (typeof raw.uuid === 'string') pendingUuid = raw.uuid
      }
    },
    decorateAssistant: () => {
      const dec = { sdkMessageId: pendingMsgId, sdkUuid: pendingUuid }
      pendingMsgId = undefined
      pendingUuid = undefined
      return dec
    },
  })
}
