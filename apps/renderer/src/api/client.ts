import type { ProjectDTO, SessionDTO, FileNode, UsageDTO, Engine, AppConfig, EngineDetail, Skill, SkillSourceDef, SkillGroupDef, ProbedSkill, LibrarySkill, CliToolDef, CustomCliTool, CliInstalledResp, UpdateMode, ProvidersResp, ProviderView, TestProviderRes, ProviderKeyEnv, ProviderModel, ProviderWireApi, SlashCommand, AutomationDTO, AutomationRunDTO, AutomationSchedule, AutomationTriggerDef, AutomationTarget, CatNode, SecretView, SecretsResp, EntityRequirement, ReqSlot, AuthStatusResp, StartOAuthResp, FinishOAuthResp, CodexLoginResp, CodexLoginStatusResp, ProxyView, ProxyProtocol, ProxyTestResult } from './types'
import { AUTH_HEADER, type AgentShellBridge, type TranscriptRecord, type RemindersConfig } from '@agent-shell/contracts'
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
  testEngine: (name: string) => req<{ ok: boolean; version: string | null; message?: string }>(`/engines/${name}/test`, { method: 'POST' }),
  listProjects: () => req<{ projects: ProjectDTO[] }>('/projects'),
  createProject: (name: string, skills?: string[]) =>
    req<{ projectId: string; path: string }>('/projects', { method: 'POST', headers: JSON_H,
      body: JSON.stringify({ name, ...(skills !== undefined ? { skills } : {}) }) }),
  // 对已打开项目注入技能（子系统 P3）：把技能库选中项软链进 <project>/.claude/skills（仅 claude，daemon 幂等）。names 为 LibrarySkill.effectiveName 列表。
  injectSkills: (projectId: string, skills: string[]) => req<{ ok: true }>(`/projects/${projectId}/inject-skills`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ skills }) }),
  renameProject: (id: string, name: string) => req<void>(`/projects/${id}`, { method: 'PUT', headers: JSON_H, body: JSON.stringify({ name }) }),
  patchProject: (id: string, b: { selectedAgent: Engine }) => req<void>(`/projects/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(b) }),
  deleteProject: (id: string) => req<{ ok: true }>(`/projects/${id}`, { method: 'DELETE' }),
  listSessions: (projectId: string) => req<{ sessions: SessionDTO[] }>(`/projects/${projectId}/sessions`),
  // ── 定时自动化（spec §8）──
  listAutomations: () => req<{ automations: AutomationDTO[] }>('/automations'),
  createAutomation: (b: { name: string; description?: string; prompt: string; engine: Engine; model: string; permission: string; category?: string[]; tags?: string[]; requires?: { kind: 'env'; name: string }[]; triggers: AutomationTriggerDef[]; executor?: 'agent' | 'script'; script?: string; interpreter?: string; target: AutomationTarget; enabled?: boolean }) =>
    req<{ automationId: string }>('/automations', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  patchAutomation: (id: string, b: Partial<{ name: string; description: string; prompt: string; engine: Engine; model: string; permission: string; category: string[]; tags: string[]; requires: { kind: 'env'; name: string }[]; triggers: AutomationTriggerDef[]; executor: 'agent' | 'script'; script: string; interpreter: string; target: AutomationTarget; enabled: boolean }>) =>
    req<{ automation: AutomationDTO }>(`/automations/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(b) }),
  deleteAutomation: (id: string) => req<{ ok: true }>(`/automations/${id}`, { method: 'DELETE' }),
  runAutomation: (id: string) => req<void>(`/automations/${id}/run`, { method: 'POST' }),
  listAutomationRuns: (id: string) => req<{ runs: AutomationRunDTO[] }>(`/automations/${id}/runs`),
  // 分类树（Plan D D6）：管理分类模态读写。
  listAutomationCategories: () => req<{ tree: CatNode[] }>('/automation-categories'),
  putAutomationCategories: (tree: CatNode[]) =>
    req<{ ok: true }>('/automation-categories', { method: 'PUT', headers: JSON_H, body: JSON.stringify({ tree }) }),
  createSession: (b: { projectId: string; engine: Engine; model: string; title?: string }) => req<{ sessionId: string }>('/sessions', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  patchSession: (id: string, b: { pinned?: boolean; title?: string; engine?: Engine; model?: string }) => req<void>(`/sessions/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(b) }),
  deleteSession: (id: string) => req<{ ok: true }>(`/sessions/${id}`, { method: 'DELETE' }),
  // §8：端点回吐原始 transcript records（重建下沉 renderer 切片 historyService.rebuildBlocks）。
  messages: (sid: string) => req<{ records: TranscriptRecord[] }>(`/sessions/${sid}/messages`),
  // contextFiles：消息附件路径（项目内相对 / 项目外绝对），daemon 据此拼 preamble + 授权读取
  // runtime：claude 权限档/思考强度，随消息生效（未运行下轮 query / 运行中热切换）
  submit: (sid: string, text: string, contextFiles: string[] = [], runtime?: { permissionMode?: string; effort?: string; sandbox?: string; approval?: string; model?: string; outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> } }, activeFile?: string | null) =>
    req<void>(`/sessions/${sid}/messages`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ text, contextFiles, ...(runtime ?? {}), activeFile }) }),
  interrupt: (sid: string) => req<void>(`/sessions/${sid}/interrupt`, { method: 'POST' }),
  // 逐工具授权 / AskUserQuestion 回执：resolve daemon 侧挂起的 canUseTool
  decision: (sid: string, body: { requestId: string; behavior: 'allow' | 'deny'; message?: string; updatedInput?: Record<string, unknown> }) =>
    req<void>(`/sessions/${sid}/decision`, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) }),
  // 不发消息、仅热切换运行时档位（claude 权限/思考强度）
  setRuntime: (sid: string, body: { permissionMode?: string; effort?: string; sandbox?: string; approval?: string; model?: string }) =>
    req<void>(`/sessions/${sid}/runtime`, { method: 'POST', headers: JSON_H, body: JSON.stringify(body) }),
  // 文件检查点回退（userMessageId 省略 → 回退到最近一次检查点）
  rewind: (sid: string, userMessageId?: string, dryRun = false) =>
    req<{ canRewind: boolean; error?: string; filesChanged?: string[]; insertions?: number; deletions?: number }>(`/sessions/${sid}/rewind`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ ...(userMessageId ? { userMessageId } : {}), dryRun }) }),
  // 动态模型列表（claude）：活动会话的 supportedModels；models 为 null = 无活会话，前端回落静态列表
  models: (sid: string) => req<{ models: { value: string; displayName: string; description: string }[] | null }>(`/sessions/${sid}/models`),
  // 动态命令列表（claude，会话入口）：四态回落（活查询实时 / 会话桶 / cwd 探针兜底 / []）。契约非 null——daemon 不再吐 null。
  commands: (sid: string) => req<{ commands: SlashCommand[] }>(`/sessions/${sid}/commands`),
  // 动态命令列表（claude，无会话入口）：按 project.path 当 cwd 走 cwd 探针缓存。供「项目已开、未建会话」。契约非 null。
  projectCommands: (projectId: string) => req<{ commands: SlashCommand[] }>(`/projects/${projectId}/commands`),
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
  // 同目录改名（文件或目录）：返回新相对路径（供同步已打开 tab 的 key）+ 最新树
  rename: (projectId: string, p: string, newName: string) => req<{ ok: true; path: string; tree: FileNode[] }>(`/projects/${projectId}/rename`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ path: p, newName }) }),
  // 移动若干源到目标目录（destDir ''=项目根）：返回 moved（新旧相对路径）+ 最新树
  move: (projectId: string, paths: string[], destDir: string) => req<{ moved: { from: string; to: string }[]; tree: FileNode[] }>(`/projects/${projectId}/move`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ paths, destDir }) }),
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
  listSkillSources: () => req<{ sources: SkillSourceDef[] }>('/skill-sources'),
  addSkillSource: (b: Omit<SkillSourceDef, 'id' | 'sortIndex'>) => req<{ source: SkillSourceDef }>('/skill-sources', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  patchSkillSource: (id: string, b: Partial<SkillSourceDef>) => req<{ source: SkillSourceDef }>(`/skill-sources/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(b) }),
  removeSkillSource: (id: string) => req<{ ok: true }>(`/skill-sources/${id}`, { method: 'DELETE' }),
  reorderSkillSources: (order: string[]) => req<{ ok: true }>('/skill-sources/reorder', { method: 'POST', headers: JSON_H, body: JSON.stringify({ order }) }),
  listSkillGroups: () => req<{ groups: SkillGroupDef[] }>('/skill-groups'),
  addSkillGroup: (b: { name: string }) => req<{ group: SkillGroupDef }>('/skill-groups', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  patchSkillGroup: (id: string, b: { name?: string }) => req<{ group: SkillGroupDef }>(`/skill-groups/${id}`, { method: 'PATCH', headers: JSON_H, body: JSON.stringify(b) }),
  removeSkillGroup: (id: string) => req<{ ok: true }>(`/skill-groups/${id}`, { method: 'DELETE' }),
  reorderSkillGroups: (order: string[]) => req<{ ok: true }>('/skill-groups/reorder', { method: 'POST', headers: JSON_H, body: JSON.stringify({ order }) }),
  probeSkillSource: (id: string) => req<{ skills: ProbedSkill[] }>(`/skill-sources/${id}/skills`),
  skillSourceMd: (id: string, relPath: string) => req<{ content: string }>(`/skill-sources/${id}/skill-md?relPath=${encodeURIComponent(relPath)}`),
  reprobeSkillSource: (id: string) => req<{ skills: ProbedSkill[] }>(`/skill-sources/${id}/reprobe`, { method: 'POST' }),
  setSourceUpdateMode: (id: string, mode: UpdateMode) => req<{ source: SkillSourceDef }>(`/skill-sources/${id}/update-mode`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ mode }) }),
  toggleSkillLib: (b: { sourceId: string; relPath: string; inLib: boolean }) => req<{ ok: true }>('/skill-library/toggle', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  listSkillLibrary: () => req<{ skills: LibrarySkill[] }>('/skill-library'),
  setAutoInject: (effectiveName: string, on: boolean) =>
    req<{ ok: true }>('/skill-library/auto-inject', { method: 'POST', headers: JSON_H, body: JSON.stringify({ effectiveName, on }) }),
  // 命令行工具（CodePilot 接入）：catalog=目录，installed=运行时检测状态，custom CRUD。安装由 agent MCP 工具执行，无 HTTP 安装路由。
  getCliCatalog: () => req<{ tools: CliToolDef[] }>('/cli-tools/catalog'),
  getCliInstalled: () => req<CliInstalledResp>('/cli-tools/installed'),
  addCustomCliTool: (binPath: string, name?: string, description?: string) =>
    req<{ tool: CustomCliTool }>('/cli-tools/custom', { method: 'POST', headers: JSON_H, body: JSON.stringify({ binPath, name, description }) }),
  removeCustomCliTool: (id: string) => req<{ ok: true }>(`/cli-tools/custom/${id}`, { method: 'DELETE' }),
  listProviders: () => req<ProvidersResp>('/providers'),
  createProvider: (b: { engine: Engine; name: string; baseUrl: string; apiKey?: string; apiKeySecretId?: string; keyEnv: ProviderKeyEnv; models?: ProviderModel[]; defaultModel?: string; wireApi?: ProviderWireApi }) =>
    req<{ provider: ProviderView }>('/providers', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  updateProvider: (id: string, b: { name?: string; baseUrl?: string; apiKey?: string; apiKeySecretId?: string; keyEnv?: ProviderKeyEnv; models?: ProviderModel[]; defaultModel?: string; wireApi?: ProviderWireApi }) =>
    req<{ provider: ProviderView }>(`/providers/${id}`, { method: 'PUT', headers: JSON_H, body: JSON.stringify(b) }),
  deleteProvider: (id: string) => req<{ ok: true }>(`/providers/${id}`, { method: 'DELETE' }),
  setActiveProvider: (engine: Engine, providerId: string) =>
    req<{ ok: true }>('/providers/active', { method: 'PUT', headers: JSON_H, body: JSON.stringify({ engine, providerId }) }),
  testProvider: (id: string, model?: string) =>
    req<TestProviderRes>(`/providers/${id}/test`, { method: 'POST', headers: JSON_H, body: JSON.stringify({ model }) }),
  // ── 凭证来源（spec 2026-06-07）：状态查询 + 设来源 + 设官网密钥引用 ──
  getAuthStatus: () => req<AuthStatusResp>('/auth/status'),
  setAuthSource: (engine: Engine, source: string) =>
    req<{ ok: true }>('/auth/source', { method: 'PUT', headers: JSON_H, body: JSON.stringify({ engine, source }) }),
  setOfficialKey: (engine: Engine, secretId: string) =>
    req<{ ok: true }>('/auth/official-key', { method: 'PUT', headers: JSON_H, body: JSON.stringify({ engine, secretId }) }),
  // ── app 内 OAuth 授权登录（Task 4.3：3 步粘码流）──
  startOAuth: (engine: Engine) =>
    req<StartOAuthResp>('/auth/oauth/start', { method: 'POST', headers: JSON_H, body: JSON.stringify({ engine }) }),
  finishOAuth: (engine: Engine, code: string, state: string) =>
    req<FinishOAuthResp>('/auth/oauth/finish', { method: 'POST', headers: JSON_H, body: JSON.stringify({ engine, code, state }) }),
  logout: (engine: Engine) =>
    req<{ ok: true }>('/auth/logout', { method: 'POST', headers: JSON_H, body: JSON.stringify({ engine }) }),
  // ── codex app 内登录引导（Part A P7.4：app-server 自管，写本机 ~/.codex）──
  // apiKey 同步成功（done:true）；chatgpt 返回 authUrl + loginSessionId，前端开浏览器后轮询 codexLoginStatus
  codexLoginStart: (body: { type: 'apiKey'; apiKey: string } | { type: 'chatgpt' }) =>
    req<CodexLoginResp>('/auth/codex/login', { method: 'POST', headers: JSON_H, body: JSON.stringify(body) }),
  codexLoginStatus: (loginSessionId: string) =>
    req<CodexLoginStatusResp>(`/auth/codex/login/${loginSessionId}`),
  // ── 代理池（Task 5.3）──
  listProxies: () => req<{ proxies: ProxyView[] }>('/proxies'),
  createProxy: (b: { name: string; protocol: ProxyProtocol; host: string; port: number; username?: string; password?: string }) =>
    req<{ proxy: ProxyView }>('/proxies', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  updateProxy: (id: string, b: { name?: string; protocol?: ProxyProtocol; host?: string; port?: number; username?: string; password?: string }) =>
    req<{ proxy: ProxyView }>(`/proxies/${id}`, { method: 'PUT', headers: JSON_H, body: JSON.stringify(b) }),
  deleteProxy: (id: string) => req<{ ok: true }>(`/proxies/${id}`, { method: 'DELETE' }),
  testProxy: (id: string) => req<ProxyTestResult>(`/proxies/${id}/test`, { method: 'POST' }),
  setSourceProxy: (engine: Engine, source: string, proxyId: string) =>
    req<{ ok: true }>('/auth/proxy', { method: 'PUT', headers: JSON_H, body: JSON.stringify({ engine, source, proxyId }) }),
  // ── 技能密钥/配置（P3）──
  listSecrets: () => req<SecretsResp>('/secrets'),
  createSecret: (b: { name: string; value: string; note?: string }) =>
    req<{ secret: SecretView }>('/secrets', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  updateSecret: (id: string, b: { name?: string; value?: string; note?: string }) =>
    req<{ secret: SecretView }>(`/secrets/${id}`, { method: 'PUT', headers: JSON_H, body: JSON.stringify(b) }),
  deleteSecret: (id: string) => req<{ ok: true }>(`/secrets/${id}`, { method: 'DELETE' }),
  listEntityRequirements: () =>
    req<{ requirements: Record<string, EntityRequirement> }>('/entity-requirements'),
  putEntityRequirements: (ref: string, b: { needsConfig: boolean; slotsSource: 'declared' | 'agent' | 'manual' | null; slots: ReqSlot[] }) =>
    req<{ ok: true }>(`/entity-requirements/${encodeURIComponent(ref)}`, { method: 'PUT', headers: JSON_H, body: JSON.stringify(b) }),
  probeSkillConfig: (b: { sourceId: string; relPath: string }) =>
    req<{ slots: ReqSlot[] }>('/skills/probe-config', { method: 'POST', headers: JSON_H, body: JSON.stringify(b) }),
  skillConfigCheck: (skills: string[]) =>
    req<{ conflicts: { env: string; entityRefs: string[]; secretIds: string[] }[]; missing: { entityRef: string; slot: string }[] }>(
      '/skill-config-check', { method: 'POST', headers: JSON_H, body: JSON.stringify({ skills }) }),
  // ── 提醒配置（spec §7）──
  getReminders: (projectId: string) => req<RemindersConfig>(`/projects/${projectId}/reminders`),
  putReminders: (projectId: string, cfg: RemindersConfig) =>
    req<RemindersConfig>(`/projects/${projectId}/reminders`, { method: 'PUT', headers: JSON_H, body: JSON.stringify(cfg) }),
  getDefaultReminders: () => req<RemindersConfig>('/reminders/default'),
  putDefaultReminders: (cfg: RemindersConfig) =>
    req<RemindersConfig>('/reminders/default', { method: 'PUT', headers: JSON_H, body: JSON.stringify(cfg) }),
  // multipart 上传；返回相对路径如 .agent-shell/sounds/xxx.m4a
  uploadReminderSound: (projectId: string, file: File): Promise<{ file: string }> => {
    const form = new FormData(); form.append('file', file, file.name)
    return req<{ file: string }>(`/projects/${projectId}/reminders/sounds`, { method: 'POST', body: form })
  },
  // 回放端点 URL（供 <audio>/ new Audio() 使用）。
  // 回放端点与项目文件端点（/api/pf/*）同属 daemon 资源型路由，daemon 通过同源 cookie（AUTH_HEADER）鉴权。
  // cookie 已在 client.ts 顶部写入（bridge.authToken），无需在 URL 内嵌 token。
  reminderSoundUrl: (projectId: string, name: string): string =>
    `${BASE}/projects/${projectId}/reminders/sounds/${encodeURIComponent(name)}`,
}
