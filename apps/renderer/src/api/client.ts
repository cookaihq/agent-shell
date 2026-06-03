import type { ProjectDTO, SessionDTO, MessageDTO, FileNode, UsageDTO, Engine, AppConfig, EngineDetail, Skill } from './types'
import { AUTH_HEADER, type AgentShellBridge } from '@agent-shell/contracts'
const BASE = '/api'
const JSON_H = { 'content-type': 'application/json' }
export class ApiError extends Error {
  constructor(public code: string, message: string, public httpStatus: number) { super(message); this.name = 'ApiError' }
}
async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const bridge = (globalThis as { agentShell?: AgentShellBridge }).agentShell
  const finalInit = bridge?.authToken
    ? { ...init, headers: { ...(init?.headers as Record<string, string> | undefined), [AUTH_HEADER]: bridge.authToken } }
    : init
  const res = await fetch(BASE + path, finalInit)
  if (!res.ok) {
    let code = 'internal', message = res.statusText
    try { const b = await res.json() as { error?: { code: string; message: string } }; if (b?.error) { code = b.error.code; message = b.error.message } } catch { /* */ }
    throw new ApiError(code, message, res.status)
  }
  if (res.status === 202 || res.status === 204) return undefined as T
  return res.json() as Promise<T>
}
export const api = {
  engines: () => req<{ engines: Record<string, string | null> }>('/engines'),
  enginesDetail: () => req<{ engines: EngineDetail[] }>('/engines/detail'),
  testEngine: (name: string) => req<{ ok: boolean; version: string | null; message?: string }>(`/engines/${name}/test`, { method: 'POST' }),
  listProjects: () => req<{ projects: ProjectDTO[] }>('/projects'),
  createProject: (name: string, skills: string[] = []) => req<{ projectId: string; path: string }>('/projects', { method: 'POST', headers: JSON_H, body: JSON.stringify({ name, skills }) }),
  renameProject: (id: string, name: string) => req<void>(`/projects/${id}`, { method: 'PUT', headers: JSON_H, body: JSON.stringify({ name }) }),
  listSessions: (projectId: string) => req<{ sessions: SessionDTO[] }>(`/projects/${projectId}/sessions`),
  createSession: (b: { projectId: string; engine: Engine; model: string; title?: string }) => req<{ sessionId: string }>('/sessions', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  patchSession: (id: string, b: { pinned?: boolean; title?: string }) => req<void>(`/sessions/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(b) }),
  messages: (sid: string) => req<{ messages: MessageDTO[] }>(`/sessions/${sid}/messages`),
  submit: (sid: string, text: string) => req<void>(`/sessions/${sid}/messages`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ text }) }),
  interrupt: (sid: string) => req<void>(`/sessions/${sid}/interrupt`, { method: 'POST' }),
  resume: (sid: string, text: string) => req<void>(`/sessions/${sid}/resume`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ text }) }),
  status: (sid: string) => req<{ running: boolean; status: string }>(`/sessions/${sid}/status`),
  usage: (sid: string) => req<UsageDTO>(`/sessions/${sid}/usage`),
  files: (projectId: string) => req<{ tree: FileNode[] }>(`/projects/${projectId}/files`),
  file: (projectId: string, p: string) => req<{ path: string; content: string; truncated: boolean }>(`/projects/${projectId}/file?path=${encodeURIComponent(p)}`),
  importFiles: (projectId: string, paths: string[]) => req<{ imported: { name: string; from: string }[]; tree: FileNode[] }>(`/projects/${projectId}/import-files`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ paths }) }),
  getConfig: () => req<AppConfig>('/config'),
  saveConfig: (b: Partial<AppConfig>) => req<AppConfig>('/config', { method: 'PUT', headers: JSON_H, body: JSON.stringify(b) }),
  listSkills: () => req<{ skills: Skill[] }>('/skills'),
  importSkill: (b: { source: 'git' | 'folder'; url?: string; path?: string }) => req<{ skill: Skill }>('/skills/import', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  deleteSkill: (name: string) => req<{ ok: true }>(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  updateSkill: (name: string) => req<{ skill: Skill }>(`/skills/${encodeURIComponent(name)}/update`, { method: 'POST' }),
}
