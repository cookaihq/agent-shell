import type { AgentEvent, Block, MessageDTO, SubagentMeta } from '../api/types'

export type RunStatus = 'idle' | 'running' | 'completed' | 'failed' | 'aborted'

/** 运行中"当前动作"（thinking/responding/tool）——复用 daemon 契约里的 ProgressActivity 形状，避免重复定义。 */
export type ProgressActivity = Extract<AgentEvent, { type: 'progress' }>['activity']

/** 聊天内挂起的交互请求：逐工具授权卡 / AskUserQuestion 选择卡。用户操作后回执 → daemon 发 permission_resolved 移除。 */
export type PendingRequest =
  | { kind: 'permission'; requestId: string; toolName: string; input: unknown; title?: string; displayName?: string; description?: string }
  | { kind: 'question'; requestId: string; questions: Extract<AgentEvent, { type: 'ask_user_question' }>['questions'] }

export interface ChatState {
  messages: MessageDTO[]
  liveBlocks: Block[] | null
  liveUsage?: { inputTokens: number; outputTokens: number; costUsd?: number; contextWindow?: number }
  /** 运行中的实时进度（估算累计 token + 当前动作），驱动底部 WorkStatus 状态行。瞬时、不落库；turn_end 清空。 */
  liveProgress?: { tokens: number; activity: ProgressActivity }
  /** 挂起的授权/提问请求（一次一个串行，但用数组留余地）；agent 等待用户回执才继续。 */
  pendingRequests: PendingRequest[]
  /** 正在逐字流式一个正文块：下一条 message(streaming) 替换末尾文本块而非新建；遇非文本事件复位。 */
  streamingActive?: boolean
  runStatus: RunStatus
  /** failed/aborted 时的真实原因（来自 turn_end.detail：引擎 stderr / result 报错）。供「任务失败」显示，别只剩一句空话。 */
  failReason?: string
  /** 子代理元数据表，键 = toolUseId（缺省时退 taskId）：task_started/progress/notification 累计（spec §6）。
   *  会话级累计、不随 turn 清空（右侧聚合面板需全量）；session 重载不持久化（本期非目标）。 */
  subagents: Record<string, SubagentMeta>
}

export const initialChat = (): ChatState => ({ messages: [], liveBlocks: null, pendingRequests: [], runStatus: 'idle', subagents: {} })

export type ChatAction =
  | { type: 'loadHistory'; messages: MessageDTO[]; running: boolean }
  | { type: 'optimisticUser'; text: string; attachments?: { name: string; path: string }[] }
  | { type: 'event'; ev: AgentEvent }

const mapStop = (s: string): RunStatus =>
  s === 'failed' ? 'failed' : s === 'aborted' ? 'aborted' : 'completed'

let seq = 0

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loadHistory':
      return { messages: action.messages, liveBlocks: null, pendingRequests: [], runStatus: action.running ? 'running' : 'idle', subagents: {} }

    case 'optimisticUser':
      return {
        ...state,
        messages: [
          ...state.messages,
          {
            id: `local-${seq++}`,
            sessionId: '',
            role: 'user',
            blocks: action.attachments && action.attachments.length
              ? [{ type: 'text', text: action.text }, { type: 'attachments', files: action.attachments }]
              : [{ type: 'text', text: action.text }],
            createdAt: Date.now(),
          },
        ],
        liveBlocks: [],
        runStatus: 'running',
        failReason: undefined,    // 新一轮开始，清掉上一轮的失败提示
        liveProgress: undefined,  // 同上：清掉上一轮可能残留的进度行
        streamingActive: false,
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
        case 'message': {
          const pp = ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}
          // 逐字流式：streaming 中且末尾是同归属的文本块 → 原地替换；否则新建文本块。streaming=false 定格并复位。
          // 归属须一致：子代理与主线文本交错时（forwardSubagentText）不可把子代理增量覆盖到主线块上。
          const lastBlk = live.length > 0 ? live[live.length - 1] : undefined
          const lastIsSameText = lastBlk?.type === 'text' && (lastBlk.parentToolUseId ?? undefined) === ev.parentToolUseId
          const nextActive = ev.streaming === true
          if (base.streamingActive && lastIsSameText) {
            const nb = [...live]; nb[nb.length - 1] = { type: 'text', text: ev.text, ...pp }
            return { ...base, liveBlocks: nb, streamingActive: nextActive }
          }
          return { ...base, liveBlocks: [...live, { type: 'text', text: ev.text, ...pp }], streamingActive: nextActive }
        }
        case 'thinking':
          return { ...base, liveBlocks: [...live, { type: 'thinking', text: ev.text, ...(ev.elapsedMs !== undefined ? { elapsedMs: ev.elapsedMs } : {}), ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}) }], streamingActive: false }
        case 'tool_use':
          // 打开始时间戳（实时计时用）；非文本事件复位流式态 → 下个文本块另起
          return { ...base, liveBlocks: [...live, { type: 'tool_use', id: ev.id, name: ev.name, input: ev.input, startedAt: Date.now(), ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}) }], streamingActive: false }
        case 'tool_result':
          return { ...base, liveBlocks: [...live, { type: 'tool_result', toolUseId: ev.toolUseId, ok: ev.ok, content: ev.content, completedAt: Date.now(), ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}) }], streamingActive: false }
        case 'subagent': {
          // 子代理生命周期累计：started/progress → running；ended → task_notification.status（默认 completed）。
          // 键优先 toolUseId（= 时间线里 Task 块 id，形态 A 据此归属）；缺省退 taskId（纯杂务/右侧聚合用）。
          const key = ev.toolUseId ?? ev.taskId
          const prev: Partial<SubagentMeta> = base.subagents[key] ?? {}
          const meta: SubagentMeta = {
            ...prev,
            taskId: ev.taskId,
            ...(ev.toolUseId ? { toolUseId: ev.toolUseId } : {}),
            ...(ev.subagentType ? { subagentType: ev.subagentType } : {}),
            ...(ev.description ? { description: ev.description } : {}),
            ...(ev.usage ? { usage: ev.usage } : {}),
            ...(ev.lastToolName ? { lastToolName: ev.lastToolName } : {}),
            ...(ev.summary ? { summary: ev.summary } : {}),
            ...(ev.skipTranscript !== undefined ? { skipTranscript: ev.skipTranscript } : {}),
            status: ev.phase === 'ended' ? (ev.status ?? 'completed') : (prev.status === 'completed' || prev.status === 'failed' || prev.status === 'stopped' ? prev.status : 'running'),
          }
          return { ...base, subagents: { ...base.subagents, [key]: meta } }
        }
        case 'usage':
          return { ...base, liveUsage: { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: ev.costUsd, contextWindow: ev.contextWindow } }
        case 'progress':
          // 瞬时进度：只更新状态行数据，不建块、不入库。
          return { ...base, liveProgress: { tokens: ev.tokens, activity: ev.activity } }
        case 'permission_request':
          // 逐工具授权卡：挂起，等用户同意/拒绝回执
          return { ...base, pendingRequests: [...base.pendingRequests, { kind: 'permission', requestId: ev.requestId, toolName: ev.toolName, input: ev.input, title: ev.title, displayName: ev.displayName, description: ev.description }] }
        case 'ask_user_question':
          // AskUserQuestion 选择卡
          return { ...base, pendingRequests: [...base.pendingRequests, { kind: 'question', requestId: ev.requestId, questions: ev.questions }] }
        case 'permission_resolved':
          // 已解决/撤销（用户操作 / 中断 / 超时）→ 移除对应卡片，避免悬挂
          return { ...base, pendingRequests: base.pendingRequests.filter((r) => r.requestId !== ev.requestId) }
        case 'turn_end':
          return {
            ...base,
            liveProgress: undefined,   // 轮结束：状态行消失，不残留（任何 stopReason 都清）
            pendingRequests: [],       // 轮结束兜底清空任何残留请求
            streamingActive: false,
            messages: live.length
              ? [
                  ...base.messages,
                  {
                    id: `live-${seq++}`,
                    sessionId: '',
                    role: 'assistant',
                    blocks: live,
                    createdAt: Date.now(),
                    ...(ev.sdkMessageId ? { sdkMessageId: ev.sdkMessageId } : {}),
                    ...(ev.sdkUuid ? { sdkUuid: ev.sdkUuid } : {}),
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
