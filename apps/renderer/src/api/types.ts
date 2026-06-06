import type { AgentEvent, NeutralTool, SessionOrigin, AutomationRunStatus } from '@agent-shell/contracts'
export type { AgentEvent, NeutralTool }
// 定时自动化类型直接复用契约（单一真相，不重复定义）
export type { AutomationSchedule, AutomationTarget, AutomationRunStatus, AutomationTrigger, AutomationDTO, AutomationRunDTO, SessionOrigin } from '@agent-shell/contracts'
export type Engine = 'claude' | 'codex'
export type SessionStatus = 'idle' | 'completed' | 'failed' | 'aborted'
export type ProjectStatus = 'running' | 'completed' | 'failed' | 'aborted' | 'idle'
export interface ProjectDTO { id: string; name: string; path: string; createdAt: number; status: ProjectStatus; engine: Engine }
export interface SessionDTO { id: string; projectId: string; engine: Engine; model: string; title: string; pinned: boolean; status: SessionStatus; resumableId: string | null; permissionMode?: string | null; effort?: string | null; claudeCodeVersion?: string | null; sdkVersion?: string | null; createdAt: number
  // 来源派生（§5.3，来自 automation_runs 关联；manual=用户手动开，automation=自动化产出）
  origin?: SessionOrigin; automationId?: string; automationName?: string; scheduleSummary?: string; automationRunStatus?: AutomationRunStatus }
// parentToolUseId：块归属的子代理 = 派生它的 Task tool_use id（来自 daemon 透传的 parent_tool_use_id）。
// 缺省 = 主线；非空 → 该块属于对应子代理的内部时间线，ChatLog 据此就地嵌套（spec 形态 A）。
export type Block =
  | { type: 'text'; text: string; parentToolUseId?: string } | { type: 'thinking'; text: string; elapsedMs?: number; parentToolUseId?: string }
  // startedAt：工具开始的本地时间戳（renderer 实时打点，用于运行计时；历史消息无此字段）
  // skipTranscript：仅 name==='Task' 的子代理块——daemon 从 task_started 回填并落库，使重载后形态 A 仍能据此从时间线排除（§9.5）
  // tool：切片归一的中立工具种类（daemon parser 写入；renderer 按它渲染，不认 Agent 原生名）；缺省 → kindOf(name) 降级（claude）
  | { type: 'tool_use'; id: string; name: string; input: unknown; startedAt?: number; parentToolUseId?: string; skipTranscript?: boolean; tool?: NeutralTool }
  // completedAt：工具结果到达的本地时间戳（配 tool_use.startedAt 算运行时长）
  | { type: 'tool_result'; toolUseId: string; ok: boolean; content: string; completedAt?: number; parentToolUseId?: string }
  | { type: 'attachments'; files: { name: string; path: string }[] }   // 消息附件回显（📎 N 个附件）
  // 轮终结状态条（失败/中止）：作为那一轮 assistant 消息的一个历史块落库 → 重载内联留痕、下一轮不清空
  // （对齐 Claudian「错误即历史」，而非会话级瞬时状态）。detail = 引擎 stderr/result 真因；中止无 detail。
  | { type: 'run_note'; stopReason: 'failed' | 'aborted'; detail?: string }

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
export interface FileNode { name: string; path: string; type: 'file' | 'dir'; symlink?: boolean; mtimeMs?: number; birthtimeMs?: number; children?: FileNode[] }
export interface UsageDTO { inputTokens: number; outputTokens: number; costUsd?: number; contextWindow?: number; contextTokens?: number; contextWindowIsAuthoritative?: boolean }
export interface AppConfig { projectsDir: string; skillsDir: string; debugMode?: boolean; engineModels?: Record<Engine, string> }
export interface EngineDetail { name: Engine; label: string; bin: string | null; version: string | null }
export interface EngineUpdateInfo { name: Engine; latestVersion: string | null; updateUrl: string }
export type SkillSource = 'git' | 'folder'
export interface Skill { name: string; source: SkillSource; origin: string; desc: string }
export type GitProvider = 'github' | 'gitee' | 'cnb' | 'gitlab' | 'other'
export type SourceType = 'folder' | 'git' | 'market'
export type UpdateMode = 'manual' | 'auto' | 'autolib'
export interface SkillSourceDef { id: string; type: SourceType; name: string; loc: string; provider?: GitProvider; branch?: string; private?: boolean; user?: string; token?: string; updateMode: UpdateMode; sortIndex: number }
export interface ProbedSkill { sourceId: string; name: string; relPath: string; desc: string; inLib: boolean; effectiveName?: string; globalIn: Engine[] }
export interface LibrarySkill { effectiveName: string; name: string; desc: string; sourceId: string; sourceName: string; globalIn: Engine[] }
// 命令行工具市场（Issue 13）：def 由 renderer 内置推荐 JSON / 自定义表单产出，加入后 daemon 持久化并生成 SKILL.md
export interface CliToolDef { id: string; name: string; cmd: string; tags: string[]; desc: string; install?: string; home?: string; usage: string; friendliness: number; custom: boolean }
export type ProviderKeyEnv = 'api_key' | 'auth_token'
export interface ProviderView {
  id: string; engine: Engine; name: string; baseUrl: string
  keyEnv: ProviderKeyEnv; hasKey: boolean; maskedKey: string; sortIndex: number; createdAt: number
}
export interface ProvidersResp { engines: Record<Engine, { active: string; providers: ProviderView[] }> }
export interface TestProviderRes { ok: boolean; status?: number; requestText: string; responseText: string }
/** 斜杠命令（来自 SDK supportedCommands / commands_changed，与 @anthropic-ai/claude-agent-sdk 的 SlashCommand 同形）。
 *  SDK 里内置命令、技能、插件命令本是同一份 SlashCommand[]、来源不可分 → 统一一份「命令」。 */
export interface SlashCommand { name: string; description: string; argumentHint: string; aliases?: string[] }
