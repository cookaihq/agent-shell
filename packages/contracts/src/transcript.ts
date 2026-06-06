import type { Engine } from './dto'

/** 一条 transcript 记录（引擎中立信封 + 原始负载）。daemon 落库 + renderer 重建共用此形状。 */
export interface TranscriptRecord {
  ts: number
  engine: Engine
  type: string
  raw: unknown
}

/**
 * 折叠相邻「同归属（parentToolUseId 一致）、且互为前缀」的流式文本块为最长那条。
 *
 * 根因：daemon 的 onEvent 对每个 message 事件都 push 一个 text 块，而 claude 流式解析器对一个文本块会发
 * 多帧 message(streaming:true) 增量 + 一帧定格 → st.blocks 里一个逻辑文本块被堆成 N 个递增前缀块。
 * live 视图有 chatReducer 去重不受影响；但重载（重建）会原样渲染 → 文本层叠重复。
 *
 * 本函数在两处复用：① daemon onTurnEnd 落库前折叠（新轮 transcript 干净，根治）；② renderer 切片
 * historyService.rebuildBlocks 读时折叠（自愈旧脏 transcript）。对已折叠/干净数据、codex 单块、含
 * thinking/tool 的序列均为 no-op。只折叠 text↔text 且一方是另一方前缀的相邻对——非前缀关系的两段不合并
 * （避免误折正常连续文本）。
 *
 * 注意：折叠保留的是整个 block 对象（含 parentToolUseId / skipTranscript 等随行字段），不做字段裁剪。
 */
export function collapseStreamingText(blocks: unknown[]): unknown[] {
  const out: unknown[] = []
  for (const b of blocks) {
    const cur = b as { type?: string; text?: string; parentToolUseId?: string }
    const last = out[out.length - 1] as { type?: string; text?: string; parentToolUseId?: string } | undefined
    if (
      cur?.type === 'text' && last?.type === 'text' &&
      (cur.parentToolUseId ?? undefined) === (last.parentToolUseId ?? undefined) &&
      typeof cur.text === 'string' && typeof last.text === 'string' &&
      (cur.text.startsWith(last.text) || last.text.startsWith(cur.text))
    ) {
      // 同一流式文本块的两帧 → 保留更长的（流式增量单调增长，定格=全文=最长）
      if (cur.text.length >= last.text.length) out[out.length - 1] = b
    } else {
      out.push(b)
    }
  }
  return out
}
