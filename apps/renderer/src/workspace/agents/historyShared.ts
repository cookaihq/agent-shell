import { collapseStreamingText } from '@agent-shell/contracts'
import type { TranscriptRecord } from '@agent-shell/contracts'
import type { Block, MessageDTO } from '../../api/types'

/**
 * §8 历史重建：transcript 原始 records → MessageDTO[]（中立块）。共享骨架 + 切片钩子。
 *
 * 共享骨架（引擎中立，本文件）：
 *   - `user_prompt` → user MessageDTO（text + 可选 attachments 块）
 *   - `assistant_blocks` → assistant MessageDTO，blocks 走 `collapseStreamingText`（§13「勿丢」折叠，
 *     与 daemon onTurnEnd 落库前同一份函数；保留每个块的 parentToolUseId / skipTranscript 不裁剪）
 *
 * 切片差异经 hooks 注入（不在共享层 if(engine)）：
 *   - claude 切片：从原始 `assistant` 记录提取 msg_id/uuid，挂到随后那条 assistant 消息（sdkMessageId/sdkUuid）
 *   - codex 切片：无 hooks → 仅共享骨架
 *
 * 历史与实时走同一套切片解析；msg_id 提取这唯一的 per-agent 分支留在 claude 切片，共享骨架零 Agent 名分支。
 * id 用 `${ord}` 序号（消息在列表内唯一即可，作 React key；不依赖 sessionId）。
 */

/** 切片私有的逐记录钩子：处理共享骨架不认的记录（如 claude 原始 assistant 流取 msg_id）。 */
export interface RebuildHooks {
  /** claude 原始 assistant 流等切片私有记录的逐条处理（取 msg_id 等，不产消息）。 */
  onRecord?(rec: TranscriptRecord): void
  /** assistant_blocks → assistant 消息时，切片补充并清空的字段（如 sdkMessageId/sdkUuid）。 */
  decorateAssistant?(): Partial<Pick<MessageDTO, 'sdkMessageId' | 'sdkUuid'>>
}

/** 共享重建骨架：user_prompt / assistant_blocks 走中立路径，其余记录交切片 hooks。 */
export function rebuildShared(records: TranscriptRecord[], hooks?: RebuildHooks): MessageDTO[] {
  const out: MessageDTO[] = []
  let ord = 0
  for (const rec of records) {
    if (rec.type === 'user_prompt') {
      const r = (rec.raw ?? {}) as { text?: string; attachments?: { name: string; path: string }[]; checkpointId?: string }
      const blocks: Block[] = [{ type: 'text', text: r.text ?? '' }]
      if (r.attachments && r.attachments.length > 0) blocks.push({ type: 'attachments', files: r.attachments })
      // checkpointId（仅 claude 会话有；daemon 落记录时同源写入）→ 挂 user MessageDTO，支撑逐条 rewind；无则降级（前端禁用该条角标）
      out.push({ id: `${ord++}`, sessionId: '', role: 'user', blocks, createdAt: rec.ts, ...(r.checkpointId ? { checkpointId: r.checkpointId } : {}) })
      continue
    }
    if (rec.type === 'assistant_blocks') {
      const r = (rec.raw ?? {}) as { blocks?: unknown[] }
      // 读时折叠：自愈旧脏 transcript 流式前缀堆叠（新轮已在 daemon onTurnEnd 折叠 → 此处 no-op）。
      // collapseStreamingText 保留整个块对象 → parentToolUseId / skipTranscript 随行不丢（§8/§11#5）。
      const blocks = collapseStreamingText(r.blocks ?? []) as Block[]
      out.push({ id: `${ord++}`, sessionId: '', role: 'assistant', blocks, createdAt: rec.ts, ...(hooks?.decorateAssistant?.() ?? {}) })
      continue
    }
    // 其余记录交切片钩子（claude 原始 assistant 流取 msg_id；codex 无钩子 → 忽略）。
    hooks?.onRecord?.(rec)
  }
  return out
}
