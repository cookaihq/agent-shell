import type { AgentEvent, Block, MessageDTO } from '../api/types'

export type RunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'aborted'

export interface ChatState {
  messages: MessageDTO[]
  liveBlocks: Block[] | null
  liveUsage?: { inputTokens: number; outputTokens: number; costUsd?: number }
  runStatus: RunStatus
  /** failed/aborted 时的真实原因（来自 turn_end.detail：引擎 stderr / result 报错）。供「任务失败」显示，别只剩一句空话。 */
  failReason?: string
}

export const initialChat = (): ChatState => ({ messages: [], liveBlocks: null, runStatus: 'idle' })

export type ChatAction =
  | { type: 'loadHistory'; messages: MessageDTO[]; running: boolean }
  | { type: 'optimisticUser'; text: string }
  | { type: 'event'; ev: AgentEvent }

const mapStop = (s: string): RunStatus =>
  s === 'failed' ? 'failed' : s === 'aborted' ? 'aborted' : 'completed'

let seq = 0

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loadHistory':
      return { messages: action.messages, liveBlocks: null, runStatus: action.running ? 'running' : 'idle' }

    case 'optimisticUser':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `local-${seq++}`,
            sessionId: '',
            role: 'user',
            blocks: [{ type: 'text', text: action.text }],
            createdAt: Date.now(),
          },
        ],
        liveBlocks: [],
        runStatus: 'running',
        failReason: undefined,   // 新一轮开始，清掉上一轮的失败提示
      }

    case 'event': {
      const ev = action.ev
      // 收到实时内容 = 新一轮正在产出（如点「继续」后引擎开始回复）：从终结态切回 running 并清失败提示，
      // 让「任务失败」灰条不会和实时输出并存（make illegal states unrepresentable）。usage/turn_end 不算内容。
      const reactivate =
        state.runStatus !== 'running' && ev.type !== 'turn_end' && ev.type !== 'usage'
      const base: ChatState = reactivate
        ? { ...state, runStatus: 'running', failReason: undefined }
        : state
      const live = base.liveBlocks ?? []
      switch (ev.type) {
        case 'message':
          return { ...base, liveBlocks: [...live, { type: 'text', text: ev.text }] }
        case 'thinking':
          return { ...base, liveBlocks: [...live, { type: 'thinking', text: ev.text }] }
        case 'tool_use':
          return { ...base, liveBlocks: [...live, { type: 'tool_use', id: ev.id, name: ev.name, input: ev.input }] }
        case 'tool_result':
          return { ...base, liveBlocks: [...live, { type: 'tool_result', toolUseId: ev.toolUseId, ok: ev.ok, content: ev.content }] }
        case 'usage':
          return { ...base, liveUsage: { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: ev.costUsd } }
        case 'turn_end':
          return {
            ...base,
            messages: live.length
              ? [
                  ...base.messages,
                  {
                    id: `live-${seq++}`,
                    sessionId: '',
                    role: 'assistant',
                    blocks: live,
                    createdAt: Date.now(),
                  },
                ]
              : base.messages,
            liveBlocks: null,
            runStatus: mapStop(ev.stopReason),
            failReason: ev.detail,   // 成功时 detail 为 undefined → 自动清空
          }
      }
      return base
    }
  }
}
