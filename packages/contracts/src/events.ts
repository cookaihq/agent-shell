import { z } from 'zod'

/** 归一后的内部事件：claude/codex 两家解析器都输出这一套（见 MVP §2.2）。
 *  streaming=true：逐字流式中的累计文本（reducer 替换当前流式块而非追加）；
 *  streaming=false/缺省：完整文本块（追加/定格）。text 始终是「到目前为止的累计全文」。 */
// parentToolUseId：本块归属的子代理标识 = 派生它的那次 Task tool_use 的 id（SDK 消息顶层 parent_tool_use_id）。
// null/缺省 → 主 agent（主线）；非空 → 该值对应子代理的内部时间线。renderer 据此把块归到对应子代理（spec §2.2/§6）。
export const MessageEvent = z.object({ type: z.literal('message'), text: z.string(), streaming: z.boolean().optional(), parentToolUseId: z.string().optional() })
// elapsedMs：思考块从 content_block_start 到 content_block_stop 的耗时（daemon 权威计时），用于折叠后显示「思考了 Xs」（Issue 17）。
export const ThinkingEvent = z.object({ type: z.literal('thinking'), text: z.string(), elapsedMs: z.number().int().nonnegative().optional(), parentToolUseId: z.string().optional() })
export const ToolUseEvent = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
  parentToolUseId: z.string().optional(),
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
})
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
 * SDK 上 tool_use_id 是 optional，纯杂务/local_workflow 可能缺省，此时只能靠 taskId 归右侧面板（spec D14）。
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

export const AgentEvent = z.discriminatedUnion('type', [
  MessageEvent,
  ThinkingEvent,
  ToolUseEvent,
  ToolResultEvent,
  UsageEvent,
  TurnEndEvent,
  ProgressEvent,
  PermissionRequestEvent,
  AskUserQuestionEvent,
  PermissionResolvedEvent,
  StructuredOutputEvent,
  SubagentEvent,
])
export type AgentEvent = z.infer<typeof AgentEvent>
export type SubagentEvent = z.infer<typeof SubagentEvent>
