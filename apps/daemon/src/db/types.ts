import type { Engine } from '@agent-shell/contracts'

export interface ProjectRow {
  id: string
  name: string
  path: string
  createdAt: number
}
export interface CreateProjectInput {
  name: string
  path: string
  id?: string   // 缺省内部生成；API 层传入使「目录名 = id」（对齐 spec）
}

/** 会话持久化状态：运行时态（running/waiting）不入库，由 M6 内存维护。 */
export type SessionStatus = 'idle' | 'completed' | 'failed' | 'aborted'

export interface SessionRow {
  id: string
  projectId: string
  engine: Engine
  model: string
  title: string
  pinned: boolean
  status: SessionStatus
  resumableId: string | null
  permissionMode: string | null   // 会话级权限档（claude permissionMode），Issue 13/29
  effort: string | null           // 会话级思考强度（当前引擎 effort），Issue 13/29
  claudeCodeVersion: string | null
  sdkVersion: string | null
  createdAt: number
}
export interface CreateSessionInput {
  projectId: string
  engine: Engine
  model: string
  title?: string
  permissionMode?: string
  effort?: string
}

export interface MessageRow {
  id: string
  sessionId: string
  role: 'user' | 'assistant'
  blocks: unknown[]
  createdAt: number
}
export interface AppendMessageInput {
  sessionId: string
  role: 'user' | 'assistant'
  blocks: unknown[]
}

export interface UsageRow {
  id: number
  sessionId: string
  turn: number
  inputTokens: number
  outputTokens: number
  costUsd: number | null
  createdAt: number
}
export interface RecordUsageInput {
  sessionId: string
  turn: number
  inputTokens: number
  outputTokens: number
  costUsd?: number
}
