import {
  z,
  PermissionRequestEvent,
  AskUserQuestionEvent,
  PermissionResolvedEvent,
  StructuredOutputEvent,
  SubagentEvent,
  CommandsChangedEvent,
} from '@agent-shell/contracts'

// claude 切片私有事件（SDK 交互回路 + 结构化输出 + 子代理生命周期）：只在 claude 会话上 safeParse 接受。
// 注意（§4.5 deferred）：本期不做 frame-name 前缀隔离（claude:subagent 等）——当前无事件名冲突，
// 且 useAgentStream safeParse 的是 data 对象而非 frame 名，故按 type 判别已足够。
export const claudeEventSchema = z.discriminatedUnion('type', [
  PermissionRequestEvent,
  AskUserQuestionEvent,
  PermissionResolvedEvent,
  StructuredOutputEvent,
  SubagentEvent,
  CommandsChangedEvent,
])
