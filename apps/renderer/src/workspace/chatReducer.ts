import type { TranscriptRecord } from '@agent-shell/contracts'
import type { AgentEvent, Block, MessageDTO } from '../api/types'

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
  liveUsage?: { inputTokens: number; outputTokens: number; costUsd?: number; contextWindow?: number; contextTokens?: number; contextWindowIsAuthoritative?: boolean }
  /** 运行中的实时进度（估算累计 token + 当前动作），驱动底部 WorkStatus 状态行。瞬时、不落库；turn_end 清空。
   *  activity 可缺省：回答 AskUserQuestion/授权后、agent 恢复但首个 progress 未到时置空 → WorkStatus 显示「处理中…」。 */
  liveProgress?: { tokens: number; activity?: ProgressActivity }
  /** 挂起的授权/提问请求（一次一个串行，但用数组留余地）；agent 等待用户回执才继续。 */
  pendingRequests: PendingRequest[]
  /** 正在逐字流式一个正文块：下一条 message(streaming) 替换末尾文本块而非新建；遇非文本事件复位。 */
  streamingActive?: boolean
  runStatus: RunStatus
  /** failed/aborted 时的真实原因（来自 turn_end.detail：引擎 stderr / result 报错）。供「任务失败」显示，别只剩一句空话。 */
  failReason?: string
  /**
   * 切片私有累计态槽（spec §5.4/§6）：外壳持有但**不解释**——subagent map 即住这里。
   * 不归外壳处理的事件（如 subagent）由外壳委托 action 携带的 sliceReduce 纯函数累计，外壳从不读其内部结构。
   * 会话级累计、不随 turn 清空（右侧聚合面板需全量）；session 重载不持久化（本期非目标）。
   */
  sliceState?: unknown
}

export const initialChat = (): ChatState => ({ messages: [], liveBlocks: null, pendingRequests: [], runStatus: 'idle' })

/** 切片私有 reducer + 初值（外壳透传，自身不解释；spec §5.4）。Workspace 按当前会话 engine 注入。 */
export interface SliceHooks {
  reduce?: (sliceState: unknown, ev: AgentEvent) => unknown
  initSliceState?: () => unknown
  /** 重载时从 transcript records replay 切片私有块还原 sliceState（P5c；缺省 → 回落 initSliceState）。 */
  rebuildSliceState?: (records: TranscriptRecord[]) => unknown
}

export type ChatAction =
  // records：本会话 transcript 原始记录（用于切片 rebuildSliceState 还原私有累计态，如 codex 子代理 P5c）。
  | { type: 'loadHistory'; messages: MessageDTO[]; running: boolean; status?: string; slice?: SliceHooks; records?: TranscriptRecord[] }
  | { type: 'optimisticUser'; text: string; attachments?: { name: string; path: string }[] }
  | { type: 'event'; ev: AgentEvent; slice?: SliceHooks }

const mapStop = (s: string): RunStatus =>
  s === 'failed' ? 'failed' : s === 'aborted' ? 'aborted' : 'completed'

let seq = 0

export function chatReducer(state: ChatState, action: ChatAction): ChatState {
  switch (action.type) {
    case 'loadHistory': {
      // 还原 runStatus：运行中优先，否则按落库的 session.status 还原失败/中止终态（缺口A 根治：
      // 旧实现写死 idle → 重载丢失「停在失败/中止」这一事实 → 最新一轮的 run_note 块拿不到「继续」按钮）。
      // 失败「真因」不在此还原——它已作为 run_note 块内联在历史里（错误即历史，不靠会话级字段）。
      const runStatus: RunStatus = action.running
        ? 'running'
        : action.status === 'failed' ? 'failed'
        : action.status === 'aborted' ? 'aborted'
        : 'idle'
      // 切片私有累计态种子（P5c）：优先用 rebuildSliceState 从 records replay 还原（codex 子代理重载===live），
      // 切片不实现（claude）或无 records → 回落 initSliceState（空态）。外壳只透传 records、不解释私有结构。
      const sliceState = action.records !== undefined && action.slice?.rebuildSliceState
        ? action.slice.rebuildSliceState(action.records)
        : action.slice?.initSliceState?.()
      return { messages: action.messages, liveBlocks: null, pendingRequests: [], runStatus, sliceState }
    }

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
      // running 状态机的唯一入口是 turn_start（daemon 每轮开始必发），外壳不再「识别内容事件反推 running」
      // （切片化后外壳甚至不认识切片私有事件类型）。内容事件只追加，不翻转运行态（spec §4.4/§11#6）。
      const base: ChatState = state
      const live = base.liveBlocks ?? []
      switch (ev.type) {
        case 'turn_start':
          // 新一轮开始：切回 running 并清上一轮失败灰条（失败灰条不与新输出并存）；起一份新 live 缓冲（已有则保留，
          // 不覆盖 optimisticUser 刚置的 []）。正常 user-submit 流里 optimisticUser 已先置 running → turn_start 幂等；
          // 真正需要它的是续接/重连轮（无 optimisticUser），由它把 idle/failed 拉回 running。不清 messages / sliceState。
          return { ...base, runStatus: 'running', failReason: undefined, liveBlocks: base.liveBlocks ?? [], liveProgress: undefined, streamingActive: false }
        case 'context_compacted':
          // TODO(isolation): 插中立分隔 divider 待 Block 类型支持（spec §4.4），本期仅消费不渲染
          return base
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
          return { ...base, liveBlocks: [...live, { type: 'tool_use', id: ev.id, name: ev.name, input: ev.input, startedAt: Date.now(), ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}), ...(ev.tool ? { tool: ev.tool } : {}) }], streamingActive: false }
        case 'tool_result':
          return { ...base, liveBlocks: [...live, { type: 'tool_result', toolUseId: ev.toolUseId, ok: ev.ok, content: ev.content, completedAt: Date.now(), ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}) }], streamingActive: false }
        case 'usage':
          return { ...base, liveUsage: { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: ev.costUsd, contextWindow: ev.contextWindow, contextTokens: ev.contextTokens, contextWindowIsAuthoritative: ev.contextWindowIsAuthoritative } }
        case 'progress':
          // 瞬时进度：只更新状态行数据，不建块、不入库。
          return { ...base, liveProgress: { tokens: ev.tokens, activity: ev.activity } }
        case 'permission_request':
          // 逐工具授权卡：挂起，等用户同意/拒绝回执
          return { ...base, pendingRequests: [...base.pendingRequests, { kind: 'permission', requestId: ev.requestId, toolName: ev.toolName, input: ev.input, title: ev.title, displayName: ev.displayName, description: ev.description }] }
        case 'ask_user_question':
          // AskUserQuestion 选择卡
          return { ...base, pendingRequests: [...base.pendingRequests, { kind: 'question', requestId: ev.requestId, questions: ev.questions }] }
        case 'permission_resolved': {
          // 已解决/撤销（用户操作 / 中断 / 超时）→ 移除对应卡片，避免悬挂
          const pendingRequests = base.pendingRequests.filter((r) => r.requestId !== ev.requestId)
          // 回答 AskUserQuestion/授权后：若无其它挂起、仍运行中、且状态行正停在「正在调用 X」(tool) →
          // 置空 activity 复用「起步态」语义 → WorkStatus 立刻显示「处理中…」，不卡在已回答的「正在调用 AskUserQuestion」；
          // agent 恢复后的首个 progress 会再覆盖为思考中/撰写回复。仅 tool 态才转（thinking/responding 不动，避免误闪）。
          const lp = base.liveProgress
          const stuckOnTool = base.runStatus === 'running' && pendingRequests.length === 0 && lp?.activity?.kind === 'tool'
          const liveProgress = stuckOnTool && lp ? { tokens: lp.tokens, activity: undefined } : lp
          return { ...base, pendingRequests, liveProgress }
        }
        case 'turn_end': {
          // 失败/中止 → 把 run_note 块并入本轮 blocks（对齐 daemon 落库），让实时与重载走同一条内联渲染（历史===实时）。
          // 即使本轮无任何正文（live 空）也据此合成一条只含 run_note 的消息 → 纯失败轮也有内联留痕。
          const noteBlock: Block | null =
            ev.stopReason === 'failed' || ev.stopReason === 'aborted'
              ? { type: 'run_note', stopReason: ev.stopReason, ...(ev.detail ? { detail: ev.detail } : {}) }
              : null
          const finalBlocks = noteBlock ? [...live, noteBlock] : live
          return {
            ...base,
            liveProgress: undefined,   // 轮结束：状态行消失，不残留（任何 stopReason 都清）
            pendingRequests: [],       // 轮结束兜底清空任何残留请求
            streamingActive: false,
            messages: finalBlocks.length
              ? [
                  ...base.messages,
                  {
                    id: `live-${seq++}`,
                    sessionId: '',
                    role: 'assistant',
                    blocks: finalBlocks,
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
      }
      // 外壳不解释的事件（如切片私有 subagent）→ 委托切片 reduce 累计进 sliceState（spec §5.4）。外壳从不读其内部结构。
      return action.slice?.reduce ? { ...base, sliceState: action.slice.reduce(base.sliceState, ev) } : base
    }
  }
}
