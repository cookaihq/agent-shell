import { z } from 'zod'

/** 归一后的内部事件：claude/codex 两家解析器都输出这一套（见 MVP §2.2）。
 *  streaming=true：逐字流式中的累计文本（reducer 替换当前流式块而非追加）；
 *  streaming=false/缺省：完整文本块（追加/定格）。text 始终是「到目前为止的累计全文」。 */
// parentToolUseId：本块归属的子代理标识 = 派生它的那次 Task tool_use 的 id（SDK 消息顶层 parent_tool_use_id）。
// null/缺省 → 主 agent（主线）；非空 → 该值对应子代理的内部时间线。renderer 据此把块归到对应子代理（spec §2.2/§6）。
export const MessageEvent = z.object({ type: z.literal('message'), text: z.string(), streaming: z.boolean().optional(), parentToolUseId: z.string().optional() })
// elapsedMs：思考块从 content_block_start 到 content_block_stop 的耗时（daemon 权威计时），用于折叠后显示「思考了 Xs」（Issue 17）。
export const ThinkingEvent = z.object({ type: z.literal('thinking'), text: z.string(), elapsedMs: z.number().int().nonnegative().optional(), parentToolUseId: z.string().optional() })
/** 中立工具种类（每个切片 daemon parser 把原生工具名归一到这一套；renderer 按它渲染，不认 Agent 原生名）。 */
export const NeutralTool = z.enum(['read', 'bash', 'edit', 'write', 'todo', 'skill'])
export type NeutralTool = z.infer<typeof NeutralTool>

export const ToolUseEvent = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
  parentToolUseId: z.string().optional(),
  /** 切片归一后的中立工具种类；缺省 → renderer 降级到 kindOf(name)（claude 兼容路径）。 */
  tool: NeutralTool.optional(),
})
export const ToolResultEvent = z.object({
  type: z.literal('tool_result'),
  toolUseId: z.string(),
  ok: z.boolean(),
  content: z.string(),
  parentToolUseId: z.string().optional(),
})
export const UsageEvent = z.object({
  type: z.literal('usage'),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
  // 模型上下文窗口大小（来自 SDKResultMessage.modelUsage[*].contextWindow）：替掉 CtxMeter 硬编码的 200k 占位。
  contextWindow: z.number().int().positive().optional(),
  /** 上下文真实占用 = input + cache_creation + cache_read（CtxMeter 百分比用它，不用 inputTokens）。 */
  contextTokens: z.number().int().nonnegative().optional(),
  /** contextWindow 是否来自运行时权威值（true）还是切片模型表估算/重载（false）。 */
  contextWindowIsAuthoritative: z.boolean().optional(),
})
/** 一轮开始：running 状态机入口，外壳不靠「识别内容事件」反推 running（spec §4.4）。 */
export const TurnStartEvent = z.object({ type: z.literal('turn_start') })
/** 上下文压缩边界（claude compact_boundary）：外壳据此重置上下文基线 + 插中立分隔。 */
export const ContextCompactedEvent = z.object({ type: z.literal('context_compacted') })
export const TurnEndEvent = z.object({
  type: z.literal('turn_end'),
  stopReason: z.string(),
  // 失败/中止收尾时的诊断信息（引擎 stderr 尾部 + 退出码）。正常结束不带。让「任务失败」能显示真因而非静默吞掉。
  detail: z.string().optional(),
  /** 本回合最后一条 assistant 的 SDK message.id / uuid（调试显示，判断重复用）。 */
  sdkMessageId: z.string().optional(),
  sdkUuid: z.string().optional(),
})

/** 运行中"当前动作"：thinking=思考 / responding=撰写正文 / tool=正在用某工具（带可选目标文件或命令）。 */
export const ProgressActivity = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('thinking') }),
  z.object({ kind: z.literal('responding') }),
  z.object({ kind: z.literal('tool'), tool: z.string(), target: z.string().optional() }),
])
export type ProgressActivity = z.infer<typeof ProgressActivity>

/** 瞬时进度事件：本轮累计输出 token 的"估算值"（边收流边算，非真实计费值）+ 当前动作。不落库，仅驱动实时状态行。 */
export const ProgressEvent = z.object({
  type: z.literal('progress'),
  tokens: z.number().int().nonnegative(),
  activity: ProgressActivity,
})

// ── SDK 交互回路事件（仅 Claude SDK runtime 产出；daemon↔renderer 一来一回） ──
/** agent 触碰需授权操作 → 聊天弹授权卡。requestId 与挂起的 canUseTool Promise 绑定；
 *  title/displayName/description 来自 SDK bridge 渲染好的提示文案（有则优先，免前端从 toolName+input 拼）。 */
export const PermissionRequestEvent = z.object({
  type: z.literal('permission_request'),
  requestId: z.string(),
  toolName: z.string(),
  input: z.unknown(),
  title: z.string().optional(),
  displayName: z.string().optional(),
  description: z.string().optional(),
})

/** 模型发 AskUserQuestion → 聊天出选择卡。questions[].options[] 对齐 AskUserQuestion 工具入参结构。 */
export const AskUserQuestionEvent = z.object({
  type: z.literal('ask_user_question'),
  requestId: z.string(),
  questions: z.array(z.object({
    question: z.string(),
    header: z.string().optional(),
    multiSelect: z.boolean().optional(),
    options: z.array(z.object({ label: z.string(), description: z.string().optional() })),
  })),
})

/** 挂起的授权/提问被解决或撤销（中断/超时/进程死）→ 通知所有订阅者清/禁用对应卡片，避免悬挂 UI。 */
export const PermissionResolvedEvent = z.object({
  type: z.literal('permission_resolved'),
  requestId: z.string(),
  outcome: z.enum(['allow', 'deny', 'cancelled']),
})

/** 结构化输出（outputFormat:json_schema）：从 SDKResultMessage.structured_output 提取，按 schema 的结果对象。UI 可后补消费。 */
export const StructuredOutputEvent = z.object({
  type: z.literal('structured_output'),
  data: z.unknown(),
})

/** 斜杠命令（与 SDK SlashCommand / renderer SlashCommand 同形）：commands_changed 事件载荷的元素形。 */
export const SlashCommandShape = z.object({
  name: z.string(),
  description: z.string(),
  argumentHint: z.string(),
  aliases: z.array(z.string()).optional(),
})

/** 命令清单中途变更（claude SDK fire-and-forget 推送 commands_changed）：daemon 经会话 SSE 转发整份新清单，
 *  让「弹框正开着」的命令列表当场刷新，不必关掉重开（slash-command-probe P1）。commands=完整新清单（REPLACE 语义）。 */
export const CommandsChangedEvent = z.object({
  type: z.literal('commands_changed'),
  commands: z.array(SlashCommandShape),
})

// ── 子代理（Task 派生的 subagent）生命周期事件（spec §2.4/§6） ──
/** 子代理实时/最终用量（来自 SDK task_progress/task_notification 的 usage，camelCase 化）。 */
export const SubagentUsage = z.object({
  totalTokens: z.number().int().nonnegative(),
  toolUses: z.number().int().nonnegative(),
  durationMs: z.number().int().nonnegative(),
})
/**
 * 子代理生命周期事件（合并三相为一个带 phase 的事件，对齐 SDK 三类 system 消息）：
 *  - phase 'started'  ← task_started（带 subagentType/description/skipTranscript）
 *  - phase 'progress' ← task_progress（实时累计 usage/lastToolName/summary，驱动卡片头实时刷新）
 *  - phase 'ended'    ← task_notification（终态 status + 定格 usage）
 * toolUseId = 派生它的 Task tool_use id（= 子消息的 parentToolUseId），renderer 据此把内部时间线归到本子代理；
 * SDK 上 tool_use_id 是 optional（纯杂务/local_workflow 可能缺省），故 reducer 以 taskId 为稳定主键归并。
 * 注意（spec D14）：无 subagentType 的纯杂务（ambient/housekeeping）本期**不进 Subagent 展示**（形态 B/C），
 * 由 renderer subagentList 在展示层过滤；contracts/daemon 仍全量透传（形态 A 时间线归并按 toolUseId 需要全量 map）。
 */
export const SubagentEvent = z.object({
  type: z.literal('subagent'),
  phase: z.enum(['started', 'progress', 'ended']),
  taskId: z.string(),
  toolUseId: z.string().optional(),
  subagentType: z.string().optional(),
  description: z.string().optional(),
  status: z.enum(['completed', 'failed', 'stopped']).optional(),
  usage: SubagentUsage.optional(),
  lastToolName: z.string().optional(),
  summary: z.string().optional(),
  skipTranscript: z.boolean().optional(),
})

// ── codex 子代理（多 thread fanout）事件（codex 切片私有，spec §4.2/§4.5/§6） ──
//
// 与 claude SubagentEvent 的本质区别（§4.3 明令不复用 parentToolUseId）：
//   - claude 子代理 = 单流，靠 `parentToolUseId`（派生它的 Task tool_use id）把内容归到子代理；
//     子内容仍走共享 message/thinking/tool_use 事件（带 parentToolUseId）混在主流里。
//   - codex 子代理 = **独立 thread**（多 thread 并发），靠 **`threadId`** 归属；子线程内容**不**走共享事件，
//     全部封进本 codex 私有事件（phase='item'），不污染主时间线。主线程内容仍走共享 AgentEvent（无 threadId 标签）。
//
// 一个 phase 标签事件覆盖子代理整生命周期（对账 app-server collabAgentToolCall + 子线程 item 通知）：
//   - 'spawned' ← spawnAgent item/completed：threadId(=receiverThreadIds[0]) + parentThreadId(=senderThreadId) + task(=prompt)
//   - 'status'  ← agentsStates[threadId].status（pendingInit→running→completed/interrupted/errored/shutdown）
//   - 'item'    ← 子线程 item/completed（reasoning/message/commandExecution/fileChange）→ 归一为一个 mini-timeline 块，带 threadId
//   - 'report'  ← wait item/completed 携带的 agentsStates[threadId].message（子代理给父的汇报）
//   - 'closed'  ← closeAgent item/completed
//   - 'wait'    ← wait item/started|completed：主代理等待编排态（驱动 cxp-wait「主代理等待中」徽章），parentThreadId + waiting
//
// 归属键永远是 threadId（spawned 的子 threadId / wait 的 parentThreadId）。中立工具种类沿用 NeutralTool。

/** codex 子线程 mini-timeline 的一个块（message/thinking/tool_use/tool_result 之一；归一自子线程 item 通知）。
 *  与中立 Block 同构子集，便于 renderer 直接喂 renderTimeline；归属在外层事件的 threadId。 */
// message 的 streaming 语义对齐共享 MessageEvent：true=逐字流式中的累计全文（reducer 替换当前流式块），
// false/缺省=定格全文（追加/落定）。子线程 agentMessage delta 累计 → streaming:true；item/completed → 定格。
export const CodexSubItem = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('message'), text: z.string(), streaming: z.boolean().optional() }),
  z.object({ kind: z.literal('thinking'), text: z.string() }),
  z.object({ kind: z.literal('tool_use'), id: z.string(), name: z.string(), input: z.unknown(), tool: NeutralTool.optional() }),
  z.object({ kind: z.literal('tool_result'), toolUseId: z.string(), ok: z.boolean(), content: z.string() }),
])
export type CodexSubItem = z.infer<typeof CodexSubItem>

/** codex 子代理状态机（agentsStates[threadId].status，probe §5）。 */
export const CodexSubStatus = z.enum(['pendingInit', 'running', 'completed', 'interrupted', 'errored', 'shutdown'])
export type CodexSubStatus = z.infer<typeof CodexSubStatus>

export const CodexSubagentEvent = z.object({
  type: z.literal('codex_subagent'),
  phase: z.enum(['spawned', 'status', 'item', 'report', 'closed', 'wait']),
  /** 归属 thread：spawned/status/item/report/closed = 子 threadId；wait = 主(发起)threadId。 */
  threadId: z.string(),
  /** 父 thread（= senderThreadId）：spawned/wait 带；renderer 据此把子代理归到对应父代理组。 */
  parentThreadId: z.string().optional(),
  /** 子代理任务（= spawnAgent.prompt 全文，子代理「身份」靠它标识，无角色名，probe §4）。spawned 带。 */
  task: z.string().optional(),
  /** 子代理状态（status 相）。 */
  status: CodexSubStatus.optional(),
  /** 子线程 mini-timeline 块（item 相）。 */
  item: CodexSubItem.optional(),
  /** 子代理汇报文本（report 相，= wait 完成时的 agentsStates[threadId].message）。 */
  report: z.string().optional(),
  /** 主代理是否正在 wait 阻塞（wait 相：started→true / completed→false）；驱动 cxp-wait 徽章。 */
  waiting: z.boolean().optional(),
})
export type CodexSubagentEvent = z.infer<typeof CodexSubagentEvent>

/** 共享生命周期 + 中立内容事件（跨 Agent 共享；切片私有事件不在内）。renderer 按 engine 取「这个 ∪ 切片 schema」safeParse。 */
export const SharedLifecycleEvent = z.discriminatedUnion('type', [
  MessageEvent, ThinkingEvent, ToolUseEvent, ToolResultEvent,
  UsageEvent, TurnStartEvent, ContextCompactedEvent, TurnEndEvent, ProgressEvent,
])
export type SharedLifecycleEvent = z.infer<typeof SharedLifecycleEvent>

export const AgentEvent = z.discriminatedUnion('type', [
  MessageEvent,
  ThinkingEvent,
  ToolUseEvent,
  ToolResultEvent,
  UsageEvent,
  TurnStartEvent,
  ContextCompactedEvent,
  TurnEndEvent,
  ProgressEvent,
  PermissionRequestEvent,
  AskUserQuestionEvent,
  PermissionResolvedEvent,
  StructuredOutputEvent,
  SubagentEvent,
  CodexSubagentEvent,
  CommandsChangedEvent,
])
export type AgentEvent = z.infer<typeof AgentEvent>
export type SubagentEvent = z.infer<typeof SubagentEvent>
