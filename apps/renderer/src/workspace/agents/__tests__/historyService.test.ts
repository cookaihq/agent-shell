import { describe, it, expect } from 'vitest'
import type { TranscriptRecord } from '@agent-shell/contracts'
import { getSlice } from '../registry'

// §8 历史重建下沉切片：迁移自 daemon transcriptToMessages 测试。
// claude 切片：含 msg_id/uuid 提取；codex 切片：仅共享骨架（无 msg_id）。
// 共享骨架断言：user_prompt→user msg、assistant_blocks→assistant msg、collapseStreamingText 折叠、
// parentToolUseId / skipTranscript 无损保留（§11#5 形态 A 重载不塌）。

const claude = getSlice('claude').historyService
const codex = getSlice('codex').historyService

describe('claude 切片 historyService.rebuildBlocks', () => {
  it('user_prompt→user DTO；assistant 流→assistant DTO（含 msg_id/uuid）', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: '你好', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'assistant', raw: { type: 'assistant', message: { id: 'msg_9', content: [{ type: 'text', text: '你好呀' }] }, uuid: 'u9' } },
      { ts: 3, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: '你好呀' }] } },
      { ts: 4, engine: 'claude', type: 'result', raw: { type: 'result', is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    expect(msgs).toHaveLength(2)
    expect(msgs[0]).toMatchObject({ role: 'user', blocks: [{ type: 'text', text: '你好' }] })
    expect(msgs[1]).toMatchObject({ role: 'assistant', sdkMessageId: 'msg_9', sdkUuid: 'u9' })
    expect(msgs[1].blocks[0]).toEqual({ type: 'text', text: '你好呀' })
  })

  it('跳过 provider 回吐的 typed-prompt user 记录（type==="user"，非 assistant 流 → 不取 msg_id、不产消息）', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: 'q', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'user', raw: { type: 'user', promptSource: 'sdk', message: { role: 'user', content: [{ type: 'text', text: 'q' }] } } },
      { ts: 3, engine: 'claude', type: 'assistant', raw: { type: 'assistant', message: { id: 'm', content: [{ type: 'text', text: 'a' }] }, uuid: 'u' } },
      { ts: 4, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'a' }] } },
      { ts: 5, engine: 'claude', type: 'result', raw: { type: 'result', is_error: false, stop_reason: 'end_turn', usage: { input_tokens: 1, output_tokens: 1 } } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[1].sdkMessageId).toBe('m')
  })

  it('assistant_blocks 含 thinking 块 → 历史保留思考（历史===实时）', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: 'q', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'assistant', raw: { type: 'assistant', message: { id: 'm', content: [] }, uuid: 'u' } },
      { ts: 3, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'thinking', text: '推理过程', elapsedMs: 1200 }, { type: 'text', text: '答案' }] } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    expect(msgs[1].blocks).toEqual([{ type: 'thinking', text: '推理过程', elapsedMs: 1200 }, { type: 'text', text: '答案' }])
    expect(msgs[1].sdkMessageId).toBe('m')
  })

  it('assistant_blocks 里流式前缀堆叠的文本被折叠（自愈旧脏 transcript）', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: 'q', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [
        { type: 'text', text: 'I will' },
        { type: 'text', text: 'I will start' },
        { type: 'text', text: 'I will start now' },
      ] } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    expect(msgs[1].blocks).toEqual([{ type: 'text', text: 'I will start now' }])
  })

  it('每轮重置 pending msg_id：上一轮的 msg_id 不串到下一轮无 assistant 流的回合', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: 'q1', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'assistant', raw: { type: 'assistant', message: { id: 'm1' }, uuid: 'u1' } },
      { ts: 3, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'a1' }] } },
      { ts: 4, engine: 'claude', type: 'user_prompt', raw: { text: 'q2', attachments: [] } },
      { ts: 5, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'a2' }] } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    const assistants = msgs.filter((m) => m.role === 'assistant')
    expect(assistants[0].sdkMessageId).toBe('m1')
    expect(assistants[1].sdkMessageId).toBeUndefined()
  })
})

describe('codex 切片 historyService.rebuildBlocks', () => {
  it('assistant_blocks → assistant DTO（直接用 blocks，无 msg_id）', () => {
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'codex', type: 'user_prompt', raw: { text: 'q', attachments: [] } },
      { ts: 2, engine: 'codex', type: 'assistant_blocks', raw: { blocks: [{ type: 'text', text: 'codex 答' }] } },
    ]
    const msgs = codex.rebuildBlocks(recs)
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant'])
    expect(msgs[1].blocks).toEqual([{ type: 'text', text: 'codex 答' }])
    expect(msgs[1].sdkMessageId).toBeUndefined()
    expect(msgs[1].sdkUuid).toBeUndefined()
  })
})

describe('旧格式兼容（§11#5：形态 A 多层嵌套重载不塌）', () => {
  it('旧 assistant_blocks 的子代理嵌套块：parentToolUseId + skipTranscript 无损保留', () => {
    // 模拟重构前 jsonl：一轮里含 Task tool_use（skipTranscript:true）+ 子代理内部块（parentToolUseId 指向 Task id）
    const recs: TranscriptRecord[] = [
      { ts: 1, engine: 'claude', type: 'user_prompt', raw: { text: '跑子代理', attachments: [] } },
      { ts: 2, engine: 'claude', type: 'assistant', raw: { type: 'assistant', message: { id: 'mT' }, uuid: 'uT' } },
      { ts: 3, engine: 'claude', type: 'assistant_blocks', raw: { blocks: [
        { type: 'tool_use', id: 'task-1', name: 'Task', input: { description: '子任务' }, skipTranscript: true },
        { type: 'text', text: '子代理在读文件', parentToolUseId: 'task-1' },
        { type: 'tool_use', id: 'inner-read', name: 'Read', input: { file_path: '/a.ts' }, parentToolUseId: 'task-1' },
        { type: 'tool_result', toolUseId: 'inner-read', ok: true, content: '...', parentToolUseId: 'task-1' },
        { type: 'text', text: '主线总结' },
      ] } },
    ]
    const msgs = claude.rebuildBlocks(recs)
    const assistant = msgs.find((m) => m.role === 'assistant')!
    // 块数不变（折叠对非前缀块 no-op）
    expect(assistant.blocks).toHaveLength(5)
    // skipTranscript 保留在 Task 块上（§9.5 重载后形态 A 据此从时间线排除）
    expect(assistant.blocks[0]).toMatchObject({ type: 'tool_use', name: 'Task', skipTranscript: true })
    // parentToolUseId 保留在每个子代理内部块上（buildChildrenMap 嵌套依赖）
    expect((assistant.blocks[1] as { parentToolUseId?: string }).parentToolUseId).toBe('task-1')
    expect((assistant.blocks[2] as { parentToolUseId?: string }).parentToolUseId).toBe('task-1')
    expect((assistant.blocks[3] as { parentToolUseId?: string }).parentToolUseId).toBe('task-1')
    // 主线块无 parentToolUseId（不误塞）
    expect((assistant.blocks[4] as { parentToolUseId?: string }).parentToolUseId).toBeUndefined()
  })
})
