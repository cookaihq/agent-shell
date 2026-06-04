import type { AgentEvent } from '@agent-shell/contracts'
export type { AgentEvent }
export type Engine = 'claude' | 'codex'
export type SessionStatus = 'idle' | 'completed' | 'failed' | 'aborted'
export type ProjectStatus = 'running' | 'completed' | 'failed' | 'aborted' | 'idle'
export interface ProjectDTO { id: string; name: string; path: string; createdAt: number; status: ProjectStatus; engine: Engine }
export interface SessionDTO { id: string; projectId: string; engine: Engine; model: string; title: string; pinned: boolean; status: SessionStatus; resumableId: string | null; permissionMode?: string | null; effort?: string | null; claudeCodeVersion?: string | null; sdkVersion?: string | null; createdAt: number }
// parentToolUseId：块归属的子代理 = 派生它的 Task tool_use id（来自 daemon 透传的 parent_tool_use_id）。
// 缺省 = 主线；非空 → 该块属于对应子代理的内部时间线，ChatLog 据此就地嵌套（spec 形态 A）。
export type Block =
  | { type: 'text'; text: string; parentToolUseId?: string } | { type: 'thinking'; text: string; elapsedMs?: number; parentToolUseId?: string }
  // startedAt：工具开始的本地时间戳（renderer 实时打点，用于运行计时；历史消息无此字段）
  | { type: 'tool_use'; id: string; name: string; input: unknown; startedAt?: number; parentToolUseId?: string }
  // completedAt：工具结果到达的本地时间戳（配 tool_use.startedAt 算运行时长）
  | { type: 'tool_result'; toolUseId: string; ok: boolean; content: string; completedAt?: number; parentToolUseId?: string }
  | { type: 'attachments'; files: { name: string; path: string }[] }   // 消息附件回显（📎 N 个附件）

/** 子代理（Task 派生）渲染元数据：来自 SubagentEvent 三相累计（spec §6 renderer·chatReducer 的 subagents map）。
 *  status：started/progress → running；ended → task_notification.status。usage 实时累计、ended 定格。 */
export interface SubagentMeta {
  taskId: string
  toolUseId?: string
  subagentType?: string
  description?: string
  status: 'running' | 'completed' | 'failed' | 'stopped'
  usage?: { totalTokens: number; toolUses: number; durationMs: number }
  lastToolName?: string
  summary?: string
  skipTranscript?: boolean
}
export interface MessageDTO { id: string; sessionId: string; role: 'user' | 'assistant'; blocks: Block[]; createdAt: number; sdkMessageId?: string; sdkUuid?: string }
export interface FileNode { name: string; path: string; type: 'file' | 'dir'; symlink?: boolean; children?: FileNode[] }
export interface UsageDTO { inputTokens: number; outputTokens: number; costUsd: number; contextWindow?: number }
export interface AppConfig { projectsDir: string; skillsDir: string; debugMode?: boolean }
export interface EngineDetail { name: Engine; label: string; bin: string | null; version: string | null }
export interface EngineUpdateInfo { name: Engine; latestVersion: string | null; updateUrl: string }
export type SkillSource = 'git' | 'folder'
export interface Skill { name: string; source: SkillSource; origin: string; desc: string }
