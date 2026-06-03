import { z } from 'zod'

/** 归一后的内部事件：claude/codex 两家解析器都输出这一套（见 MVP §2.2）。 */
export const MessageEvent = z.object({ type: z.literal('message'), text: z.string() })
export const ThinkingEvent = z.object({ type: z.literal('thinking'), text: z.string() })
export const ToolUseEvent = z.object({
  type: z.literal('tool_use'),
  id: z.string(),
  name: z.string(),
  input: z.unknown(),
})
export const ToolResultEvent = z.object({
  type: z.literal('tool_result'),
  toolUseId: z.string(),
  ok: z.boolean(),
  content: z.string(),
})
export const UsageEvent = z.object({
  type: z.literal('usage'),
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative().optional(),
})
export const TurnEndEvent = z.object({
  type: z.literal('turn_end'),
  stopReason: z.string(),
  // 失败/中止收尾时的诊断信息（引擎 stderr 尾部 + 退出码）。正常结束不带。让「任务失败」能显示真因而非静默吞掉。
  detail: z.string().optional(),
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

export const AgentEvent = z.discriminatedUnion('type', [
  MessageEvent,
  ThinkingEvent,
  ToolUseEvent,
  ToolResultEvent,
  UsageEvent,
  TurnEndEvent,
  ProgressEvent,
])
export type AgentEvent = z.infer<typeof AgentEvent>
