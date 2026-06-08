import type { TranscriptRecord, AgentEvent } from '@agent-shell/contracts'
import type { MessageDTO } from '../../../api/types'
import { rebuildShared } from '../historyShared'
import { initCodexSubagentState, codexSubagentReduce } from './subagentView'

/**
 * codex 切片历史重建（§8）：仅共享骨架（user_prompt + assistant_blocks）。
 *
 * codex 不发原始 assistant 流记录、无 msg_id 概念 → 不挂任何切片钩子（共享骨架已足）。
 *
 * 注意：assistant_blocks 里混有 daemon 落库的 codex_subagent 私有块（P5c）。这些块不是中立可渲染块，
 * 但 rebuildShared 原样把整个 blocks 数组喂进 assistant MessageDTO——它们对共享渲染层无害（renderTimeline
 * 只认 text/thinking/tool_use/tool_result/run_note，未知 type 被忽略），子代理详情由 rebuildSliceState
 * replay 进 sliceState、三挂载点据此渲染。锚点 spawnAgent tool_use 块仍是共享 tool_use，正常保留。
 */
export function codexRebuildBlocks(records: TranscriptRecord[]): MessageDTO[] {
  return rebuildShared(records)
}

/**
 * codex 切片私有累计态重载还原（§5.4/§6，P5c）：
 *   从 transcript records 的 assistant_blocks 里抽出 daemon 落库的 codex_subagent 私有块，按落库顺序
 *   replay 进**同一份** codexSubagentReduce → 得到与 live SSE 累计完全一致的 sliceState（单一真相，不另写重建逻辑）。
 *
 * daemon 落库形状（sessionRuntime onEvent）：`{ type: 'codex_subagent', ...ev }`，即整个 CodexSubagentEvent
 * 原样存为块（带 threadId/phase/parentThreadId/task/status/item/report/waiting）。此处直接当 AgentEvent 喂回 reduce。
 *
 * 流式 message 帧（item.streaming:true）即便全帧落库，reduce 的 appendItem 对流式帧做替换语义 → 折叠在 replay 时完成，
 * 与 live 同（无需读时额外折叠）。
 */
export function codexRebuildSliceState(records: TranscriptRecord[]): unknown {
  let state = initCodexSubagentState()
  for (const rec of records) {
    if (rec.type !== 'assistant_blocks') continue
    const blocks = (rec.raw as { blocks?: unknown[] } | null)?.blocks ?? []
    for (const b of blocks) {
      if ((b as { type?: string })?.type === 'codex_subagent') {
        // 块即原样的 CodexSubagentEvent（含 type:'codex_subagent'）→ 直接喂回 reduce（单一真相）。
        state = codexSubagentReduce(state, b as AgentEvent)
      }
    }
  }
  return state
}
