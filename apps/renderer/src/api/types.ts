import type { AgentEvent } from '@agent-shell/contracts'
export type { AgentEvent }
export type Engine = 'claude' | 'codex'
export type SessionStatus = 'idle' | 'completed' | 'failed' | 'aborted'
export type ProjectStatus = 'running' | 'completed' | 'failed' | 'aborted' | 'idle'
export interface ProjectDTO { id: string; name: string; path: string; createdAt: number; status: ProjectStatus; engine: Engine }
export interface SessionDTO { id: string; projectId: string; engine: Engine; model: string; title: string; pinned: boolean; status: SessionStatus; resumableId: string | null; createdAt: number }
export type Block =
  | { type: 'text'; text: string } | { type: 'thinking'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; ok: boolean; content: string }
export interface MessageDTO { id: string; sessionId: string; role: 'user' | 'assistant'; blocks: Block[]; createdAt: number }
export interface FileNode { name: string; path: string; type: 'file' | 'dir'; children?: FileNode[] }
export interface UsageDTO { inputTokens: number; outputTokens: number; costUsd: number }
export interface AppConfig { projectsDir: string; skillsDir: string }
export interface EngineDetail { name: Engine; label: string; bin: string | null; version: string | null }
export type SkillSource = 'git' | 'folder'
export interface Skill { name: string; source: SkillSource; origin: string; desc: string }
