import type { ProjectDTO, SessionDTO, MessageDTO, FileNode, UsageDTO, Engine, AppConfig, EngineDetail, EngineUpdateInfo, Skill } from './types'
import { AUTH_HEADER, type AgentShellBridge } from '@agent-shell/contracts'
const BASE = '/api'
const JSON_H = { 'content-type': 'application/json' }

// 启动即写同源 cookie：renderer 的 fetch 走请求头带 token，但浏览器发起的 <img>/<iframe>（及其相对子资源）
// 带不了自定义头——同源会自动带 cookie，文件流路由 /api/pf/* 靠它过 daemon 宽门（见 daemon server.ts gate）。
{
  const bridge = (globalThis as { agentShell?: AgentShellBridge }).agentShell
  if (bridge?.authToken && typeof document !== 'undefined') {
    try { document.cookie = `${AUTH_HEADER}=${encodeURIComponent(bridge.authToken)}; path=/; SameSite=Strict` } catch { /* noop */ }
  }
}
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
  enginesUpdates: () => req<{ updates: EngineUpdateInfo[] }>('/engines/updates'),
  testEngine: (name: string) => req<{ ok: boolean; version: string | null; message?: string }>(`/engines/${name}/test`, { method: 'POST' }),
  listProjects: () => req<{ projects: ProjectDTO[] }>('/projects'),
  createProject: (name: string, skills: string[] = []) => req<{ projectId: string; path: string }>('/projects', { method: 'POST', headers: JSON_H, body: JSON.stringify({ name, skills }) }),
  renameProject: (id: string, name: string) => req<void>(`/projects/${id}`, { method: 'PUT', headers: JSON_H, body: JSON.stringify({ name }) }),
  listSessions: (projectId: string) => req<{ sessions: SessionDTO[] }>(`/projects/${projectId}/sessions`),
  createSession: (b: { projectId: string; engine: Engine; model: string; title?: string }) => req<{ sessionId: string }>('/sessions', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  patchSession: (id: string, b: { pinned?: boolean; title?: string }) => req<void>(`/sessions/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(b) }),
  deleteSession: (id: string) => req<{ ok: true }>(`/sessions/${id}`, { method: 'DELETE' }),
  messages: (sid: string) => req<{ messages: MessageDTO[] }>(`/sessions/${sid}/messages`),
  // contextFiles：消息附件路径（项目内相对 / 项目外绝对），daemon 据此拼 preamble + 授权读取
  // runtime：claude 权限档/思考强度，随消息生效（未运行下轮 query / 运行中热切换）
  submit: (sid: string, text: string, contextFiles: string[] = [], runtime?: { permissionMode?: string; effort?: string; model?: string; outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> } }) =>
    req<void>(`/sessions/${sid}/messages`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ text, contextFiles, ...(runtime ?? {}) }) }),
  interrupt: (sid: string) => req<void>(`/sessions/${sid}/interrupt`, { method: 'POST' }),
  // 逐工具授权 / AskUserQuestion 回执：resolve daemon 侧挂起的 canUseTool
  decision: (sid: string, body: { requestId: string; behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown> }) =>
    req<void>(`/sessions/${sid}/decision`, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) }),
  // 不发消息、仅热切换运行时档位（claude 权限/思考强度）
  setRuntime: (sid: string, body: { permissionMode?: string; effort?: string; model?: string }) =>
    req<void>(`/sessions/${sid}/runtime`, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) }),
  // 文件检查点回退（userMessageId 省略 → 回退到最近一次检查点）
  rewind: (sid: string, userMessageId?: string, dryRun = false) =>
    req<{ canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number }>(`/sessions/${sid}/rewind`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ ...(userMessageId ? { userMessageId } : {}), dryRun }) }),
  // 动态模型列表（claude）：活动会话的 supportedModels；models 为 null = 无活会话，前端回落静态列表
  models: (sid: string) => req<{ models: { value: string; displayName: string; description: string }[] | null }>(`/sessions/${sid}/models`),
  resume: (sid: string, text: string) => req<void>(`/sessions/${sid}/resume`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ text }) }),
  status: (sid: string) => req<{ running: boolean; status: string }>(`/sessions/${sid}/status`),
  usage: (sid: string) => req<UsageDTO>(`/sessions/${sid}/usage`),
  files: (projectId: string) => req<{ tree: FileNode[] }>(`/projects/${projectId}/files`),
  file: (projectId: string, p: string) => req<{ path: string; content: string; truncated: boolean }>(`/projects/${projectId}/file?path=${encodeURIComponent(p)}`),
  // 项目文件原始字节 URL（同源，cookie 过门）：图片 <img> / PDF·HTML <iframe src> / md 相对图。p 为项目内相对路径。
  rawUrl: (projectId: string, p: string) => `${BASE}/pf/${projectId}/${p.split('/').filter(Boolean).map(encodeURIComponent).join('/')}`,
  absPath: (projectId: string, p: string) => req<{ absPath: string }>(`/projects/${projectId}/abs-path?path=${encodeURIComponent(p)}`),
  // dir：可选子目录（消息附件传 'attachments'；文件面板拖入不传=项目根）
  importFiles: (projectId: string, paths: string[], dir?: string) => req<{ imported: { name: string; from: string }[]; tree: FileNode[] }>(`/projects/${projectId}/import-files`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ paths, ...(dir ? { dir } : {}) }) }),
  // 新建文件/目录（Issue 15）：path 为项目内相对路径（当前选中目录 + 名字），kind 区分文件/夹
  createEntry: (projectId: string, p: string, kind: 'file' | 'dir') => req<{ ok: true; tree: FileNode[] }>(`/projects/${projectId}/create`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ path: p, kind }) }),
  // 粘贴：剪贴板字节无源路径 → multipart 上传写进 <project>/attachments/，返回相对路径
  uploadPaste: (projectId: string, blob: Blob, name: string) => {
    const form = new FormData(); form.append('file', blob, name)
    return req<{ file: { name: string; path: string; size: number } }>(`/projects/${projectId}/attachments/paste`, { method: 'POST', body: form })
  },
  rawRecord: (sessionId: string, msgId: string) =>
    req<{ record: unknown }>(`/sessions/${sessionId}/raw?msgId=${encodeURIComponent(msgId)}`),
  getConfig: () => req<AppConfig>('/config'),
  saveConfig: (b: Partial<AppConfig>) => req<AppConfig>('/config', { method: 'PUT', headers: JSON_H, body: JSON.stringify(b) }),
  listSkills: () => req<{ skills: Skill[] }>('/skills'),
  importSkill: (b: { source: 'git' | 'folder'; url?: string; path?: string }) => req<{ skill: Skill }>('/skills/import', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  deleteSkill: (name: string) => req<{ ok: true }>(`/skills/${encodeURIComponent(name)}`, { method: 'DELETE' }),
  updateSkill: (name: string) => req<{ skill: Skill }>(`/skills/${encodeURIComponent(name)}/update`, { method: 'POST' }),
}
