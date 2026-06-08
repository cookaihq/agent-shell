import { z, CodexSubagentEvent } from '@agent-shell/contracts'

// codex 切片私有事件：只在 codex 会话上 safeParse 接受（与共享生命周期事件并集后判别）。
//
// 与 claude 切片的区别（spec §4.2/§4.3）：codex 子代理 = 独立 thread fanout，子线程内容全部封进
// CodexSubagentEvent（按 threadId 归属），**不**走共享 message/thinking/tool_use（避免污染主时间线）；
// 因此 codex 私有事件目前只有 CodexSubagentEvent 一种（claude 那套 permission/ask/structured 回路当前 codex 未走）。
//
// 注意（对齐 claudeEventSchema 注释）：本期不做 frame-name 前缀隔离——当前无事件名冲突，
// useAgentStream safeParse 的是 data 对象而非 frame 名，按 type 判别已足够。
//
// 用 z.discriminatedUnion 与 claudeEventSchema 保持同构（便于将来追加更多 codex 私有事件）。
export const codexEventSchema = z.discriminatedUnion('type', [
  CodexSubagentEvent,
])
