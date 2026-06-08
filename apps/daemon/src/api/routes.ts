import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import type Database from 'better-sqlite3'
import { CreateProjectReq, CreateSessionReq, SubmitMessageReq, ResumeReq, DecisionReq, RuntimeConfigReq, RewindReq, InjectSkillsReq, type ApiError, type AppConfig, CreateProviderReq, UpdateProviderReq, SetActiveProviderReq, SetAuthSourceReq, SetOfficialKeyReq, StartOAuthReq, FinishOAuthReq, LogoutReq, type AuthStatusResp, type CliLoginStatus, type Engine, triggersSummary, CreateSecretReq, UpdateSecretReq, PutEntityRequirementReq, SkillConfigCheckReq, SetAutoInjectReq, CreateProxyReq, UpdateProxyReq, SetSourceProxyReq, PatchSessionReq, PatchProjectReq } from '@agent-shell/contracts'
import type { ProviderStore } from '../providers/store'
import type { ProxyStore } from '../proxy/store'
import { toProxyView } from '../proxy/store'
import type { SecretStore } from '../secrets/store'
import type { AuthSourceStore } from '../auth/sourceStore'
import type { OAuthTokenStore } from '../auth/oauthTokenStore'
import type { EntityRequirementStore } from '../skills/entityRequirements'
import { resolveSkillEnv } from '../skills/secretsResolve'
import { listInjectedSkills } from '../skills/injected'
import { createProject, deleteProject, getProject, listProjectsWithStatus, renameProject, setProjectSelectedAgent, uuid32 } from '../db/projects'
import { createSession, getSession, getSessionsByProject, setSessionPinned, setSessionTitle, setSessionRuntime, deleteSession, changeSessionEngine } from '../db/sessions'
import { scanTree, readProjectFile, resolveProjectFile, resolveProjectPath, importFiles, saveAttachmentBytes, createEntry, renameEntry, moveEntry, FileAccessError } from './files'
import { sumUsage } from '../db/usage'
import { sessionsDir, readRecords, sessionHasMessages } from '../session/transcript'
import type { SessionRuntime } from '../session/sessionRuntime'
import { detectEngineVersion, engineLabel } from '../runtimes/engineInfo'
import { scanSkills, SkillError } from '../skills/store'
import { injectClaudeSkills } from '../skills/inject'
import { createProjectWithSkills } from '../projects/createWithSkills'
import { AddSourceReq, PatchSourceReq, ReorderSourcesReq, ToggleLibReq, UpdateMode, AddCustomCliToolReq, ProbeConfigReq, InstallSkillReq, CreateSkillReq, type SkillSourceDef, AddGroupReq, PatchGroupReq, ReorderGroupsReq } from '@agent-shell/contracts'
import { makeSkillService } from '../skills/service'
import { makeCliToolService } from '../clitools/service'
import { cleanupLegacyCliToolSkills } from '../clitools/cleanup'
import { skillSourcesPath, skillSrcCacheDir, projectSoundsDir, automationCategoriesPath } from '../paths'
import { testClaudeProvider } from '../providers/testConnectivity'
import { createAutomationRouter } from './automations'
import type { AutomationScheduler } from '../automation/scheduler'
import type { AutomationStore } from '../automation/automationStore'
import type { AutomationRunDone } from '../automation/runHandler'
import { RemindersConfig, parseReminders } from '@agent-shell/contracts'
import { readProjectReminders, writeProjectReminders, readDefaultReminders, writeDefaultReminders } from '../reminders/store'
import type { ClaudeLoginState } from '../auth/claudeLoginDetect'
import type { CodexLoginState } from '../auth/codexLoginDetect'
import type { CodexLoginParams, CodexLoginResult } from '../auth/codexLogin'
import { genPkce, genState, buildAuthorizeUrl, exchangeCode } from '../auth/claudeOAuth'
import { CodexLoginReq } from '@agent-shell/contracts'

export interface ApiDeps {
  db: Database.Database
  runtime: SessionRuntime
  readConfig: () => AppConfig
  writeConfig: (p: Partial<AppConfig>) => AppConfig
  detect: () => Record<'claude' | 'codex', string | null>
  transcriptDir?: string
  /** 测试注入：源清单文件路径 / git 缓存目录；缺省用 paths.ts 真实路径。 */
  skillSourcesPath?: string
  skillSrcCacheDir?: string
  /** 测试注入：命令行工具清单文件路径；缺省用 paths.ts 真实路径。 */
  cliToolsPath?: string
  providers: ProviderStore
  /** 代理池存储（Task 5.3 的 /proxies CRUD + /auth/proxy 绑定路由消费）。 */
  proxies: ProxyStore
  /** 凭证来源唯一权威（Task 2.x 登录/凭证来源）；/auth/status·source·official-key 路由消费。 */
  authSources: AuthSourceStore
  /** app 内 OAuth 令牌库（与 authSources 共写 auth.json）；Task 4.3 的 finish/logout 路由消费。可选——路由接入前不强制。 */
  oauthTokens?: OAuthTokenStore
  /** 测试注入 OAuth 换 token 的 fetch；缺省走 exchangeCode 内的全局 fetch。 */
  oauthFetch?: typeof fetch
  /** 本机 claude 登录检测（由 server.ts 注入，缺省层在 startDaemon 收敛——对齐 detect）。 */
  claudeLogin: () => ClaudeLoginState
  /** 本机 codex 登录检测（读 ~/.codex/auth.json；由 server.ts 注入，缺省 detectCodexLogin）。Part A P7：取代旧 codex 恒 unknown。 */
  codexLogin: () => CodexLoginState
  /** codex app 内登录引导（P7.4，app-server 自管，写本机 ~/.codex）：apiKey 同步成功 / chatgpt 经 onAuthUrl 回吐授权地址、Promise 在 completed 通知后 resolve。
   *  由 server.ts 注入闭包（已绑 bundled codex binPath/pathDir）；缺省=不提供（路由返回 501）。测试可注入假实现。 */
  codexLoginStart?: (params: CodexLoginParams, onAuthUrl?: (authUrl: string) => void) => Promise<CodexLoginResult>
  /** 命名密钥库 + 实体需求清单（技能密钥 P1）。 */
  secrets: SecretStore
  entityReqs: EntityRequirementStore
  /** 定时自动化调度器（/automations 路由 + 启停重排）。 */
  scheduler: AutomationScheduler
  /** 文件态自动化仓库（定义 CRUD + 会话来源派生）。 */
  store: AutomationStore
  /** 测试注入：分类树存储文件路径；缺省用 paths.ts 真实路径（隔离测试用）。 */
  automationCategoriesPath?: string
  /** 订阅自动化 run 结束事件（→ /automations/events SSE，桌面壳系统通知）。 */
  onRunDone: (fn: (d: AutomationRunDone) => void) => () => void
  /** 内置技能目录（§9 builtin 源）；提供则在 router 初始化时幂等注册 builtin 源。 */
  builtinSkillsDir?: string
  /** 用户创建的技能存放目录（created 源）；测试注入用于隔离。 */
  createdSkillsDir?: string
  /** 测试注入：技能分组清单文件路径；缺省从 sourcesFile 同目录派生。 */
  skillGroupsPath?: string
}

const apiErr = (code: string, message: string): ApiError => ({ error: { code, message } })

/** 源响应脱敏：私有库 token 绝不回传 renderer（编辑时「留空=保持」）。 */
const redactSource = (s: SkillSourceDef): SkillSourceDef => ({ ...s, token: undefined })

export function createApiRouter(deps: ApiDeps): express.Router {
  const r = express.Router()

  const skills = makeSkillService(
    () => deps.readConfig().skillsDir,
    deps.skillSourcesPath ?? skillSourcesPath(),
    deps.skillSrcCacheDir ?? skillSrcCacheDir(),
    undefined,            // home 用缺省
    deps.entityReqs,      // 持久化 needsConfig 用
    deps.createdSkillsDir, // created 源目录（测试注入；缺省用 paths.ts 真实路径）
    deps.skillGroupsPath,  // 分组清单文件（测试注入；undefined → 从 sourcesFile 同目录派生）
  )
  if (deps.builtinSkillsDir) {
    try { skills.ensureBuiltinSource(deps.builtinSkillsDir) } catch (e) { console.error('[builtin] 注册失败', e) }
  }
  try { skills.ensureCreatedSource() } catch (e) { console.error('[created] 注册失败', e) }
  // 一次性启动清理：删旧 clitools/skill.ts 生成的库残留（sourceId==='cli-tools' 条目 + cli-<id> 目录）。
  // 失败仅记日志、不阻断启动。
  try { cleanupLegacyCliToolSkills(deps.readConfig().skillsDir) } catch (e) { console.error('[cli-tools] 旧残留清理失败', e) }
  const skillErr = (res: express.Response, e: unknown) => {
    if (e instanceof SkillError) {
      const code = e.reason === 'not_found' ? 404 : e.reason === 'forbidden' ? 403 : 400
      return res.status(code).json(apiErr(e.reason, e.message))
    }
    throw e
  }

  const cliTools = makeCliToolService(deps.cliToolsPath)

  // 定时自动化路由组（spec §8）
  r.use(createAutomationRouter({ db: deps.db, store: deps.store, scheduler: deps.scheduler, automationCategoriesPath: deps.automationCategoriesPath ?? automationCategoriesPath(), onRunDone: deps.onRunDone }))

  r.post('/projects', (req, res) => {
    const parsed = CreateProjectReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '缺少 name'))
    const proj = createProjectWithSkills(
      { db: deps.db, projectsDir: deps.readConfig().projectsDir, skillsDir: deps.readConfig().skillsDir },
      parsed.data.name, parsed.data.skills,
    )
    res.status(201).json({ projectId: proj.id, path: proj.path })
  })

  // 对已存在项目注入技能（子系统 P3）：据 :id 查项目 path，复用 injectClaudeSkills 软链进 <project>/.claude/skills（仅 claude，幂等：已存在链接 / 库中缺失名均跳过）。
  r.post('/projects/:id/inject-skills', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const parsed = InjectSkillsReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '注入参数非法'))
    injectClaudeSkills(proj.path, deps.readConfig().skillsDir, parsed.data.skills)
    res.json({ ok: true })
  })

  r.get('/projects', (_req, res) => {
    res.json({ projects: listProjectsWithStatus(deps.db, (id) => deps.runtime.isRunning(id)) })
  })

  r.get('/config', (_req, res) => { res.json(deps.readConfig()) })
  r.put('/config', (req, res) => {
    const b = req.body as { projectsDir?: unknown; skillsDir?: unknown; automationsDir?: unknown; debugMode?: unknown; engineModels?: unknown }
    const patch: Partial<AppConfig> = {}
    if (typeof b?.projectsDir === 'string' && b.projectsDir.trim()) patch.projectsDir = b.projectsDir.trim()
    if (typeof b?.skillsDir === 'string' && b.skillsDir.trim()) patch.skillsDir = b.skillsDir.trim()
    if (typeof b?.automationsDir === 'string' && b.automationsDir.trim()) patch.automationsDir = b.automationsDir.trim()
    if (typeof b?.debugMode === 'boolean') patch.debugMode = b.debugMode
    if (b?.engineModels && typeof b.engineModels === 'object') {
      const validated: Record<string, string> = {}
      for (const [k, v] of Object.entries(b.engineModels as Record<string, unknown>)) {
        if (typeof v === 'string') validated[k] = v
      }
      patch.engineModels = { ...deps.readConfig().engineModels, ...validated }
    }
    res.json(deps.writeConfig(patch))
  })

  r.post('/sessions', (req, res) => {
    const parsed = CreateSessionReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '会话参数非法'))
    if (!getProject(deps.db, parsed.data.projectId)) return res.status(404).json(apiErr('not_found', '项目不存在'))
    // permissionMode/effort 透传到 createSession（Issue 13：新会话继承上次档位）
    const sess = createSession(deps.db, parsed.data)
    res.status(201).json({ sessionId: sess.id })
  })

  r.get('/projects/:id/sessions', (req, res) => {
    // 会话来源（§5.3）：被 automation_runs.sessionId 引用 → origin='automation'（附自动化名/调度摘要），否则 'manual'。
    // 派生值，不在 sessions 表另存列——杜绝「删了自动化但会话仍标 automation」的中间态。
    const origins = deps.store.originsBySession()
    const sessions = getSessionsByProject(deps.db, req.params.id).map((s) => {
      const o = origins.get(s.id)
      return o
        ? { ...s, origin: 'automation' as const, automationId: o.automationId, automationName: o.automationName, scheduleSummary: triggersSummary(o.triggers), automationRunStatus: o.runStatus }
        : { ...s, origin: 'manual' as const }
    })
    res.json({ sessions })
  })

  // §8：发原始 records（引擎中立信封 + raw），由 renderer 各切片 historyService.rebuildBlocks 重建成中立块。
  // 旧版「daemon 预拼 MessageDTO」职责下沉切片 → 历史与实时走同一套切片解析（claude msg_id 提取归 claude 切片）。
  r.get('/sessions/:id/messages', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    const dir = deps.transcriptDir ?? sessionsDir()
    res.json({ records: readRecords(dir, req.params.id) })
  })

  r.get('/sessions/:id/raw', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    const msgId = typeof req.query.msgId === 'string' ? req.query.msgId : ''
    if (!msgId) return res.status(400).json(apiErr('invalid_request', '缺少 msgId'))
    const dir = deps.transcriptDir ?? sessionsDir()
    const rec = readRecords(dir, req.params.id).find((x) => (x.raw as any)?.message?.id === msgId)
    if (!rec) return res.status(404).json(apiErr('not_found', '未找到该记录'))
    res.json({ record: rec })
  })

  r.post('/sessions/:id/messages', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    const parsed = SubmitMessageReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '消息参数非法'))
    const { text, contextFiles, permissionMode, effort, model, outputFormat, sandbox, approval, activeFile } = parsed.data
    // 运行时档位（claude 权限/思考强度/模型/结构化输出 + codex 两轴 sandbox/approval）随消息携带：未运行下轮 query/turn 生效，运行中热切换（outputFormat 仅新 query 生效；codex sandbox/approval 下个新 turn/start 生效）
    const runtime = (permissionMode !== undefined || effort !== undefined || model !== undefined || outputFormat !== undefined || sandbox !== undefined || approval !== undefined) ? { permissionMode, effort, model, outputFormat, sandbox, approval } : undefined
    // 持久化会话级档位（Issue 13/29 + codex 两轴 Part A P3）：随消息带的权限/思考强度/模型/沙箱/审批落库，重开会话回填
    if (permissionMode !== undefined || effort !== undefined || model !== undefined || sandbox !== undefined || approval !== undefined) setSessionRuntime(deps.db, req.params.id, { permissionMode, effort, model, sandbox, approval })
    deps.runtime.submit(req.params.id, text, contextFiles, runtime, activeFile)
    res.status(202).json({ ok: true })
  })

  // 逐工具授权 / AskUserQuestion 回执：resolve 挂起的 canUseTool Promise，agent 据此继续/拒绝
  r.post('/sessions/:id/decision', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    const parsed = DecisionReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '回执参数非法'))
    const { requestId, behavior, message, updatedInput } = parsed.data
    deps.runtime.resolveDecision(req.params.id, requestId, { behavior, message, updatedInput })
    res.status(202).json({ ok: true })
  })

  // 不发消息、仅热切换运行时档位（claude 权限/思考强度）
  r.post('/sessions/:id/runtime', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    const parsed = RuntimeConfigReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '档位参数非法'))
    // 持久化会话级档位（Issue 13/29）：热切换的权限/思考强度落库
    setSessionRuntime(deps.db, req.params.id, parsed.data)
    deps.runtime.setRuntimeConfig(req.params.id, parsed.data)
    res.status(202).json({ ok: true })
  })

  // 文件检查点回退到某条 user 消息（claude）
  r.post('/sessions/:id/rewind', async (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    const parsed = RewindReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '回退参数非法'))
    const result = await deps.runtime.rewindFiles(req.params.id, parsed.data.userMessageId, { dryRun: parsed.data.dryRun })
    res.json(result)
  })

  r.post('/sessions/:id/interrupt', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    deps.runtime.interrupt(req.params.id)
    res.status(202).json({ ok: true })
  })

  // resume = 对（通常已终结的）会话发一条续接消息；SessionRuntime.submit 空闲态自动用 resumable_id 起 resume 进程
  r.post('/sessions/:id/resume', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    const parsed = ResumeReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '缺少 text'))
    deps.runtime.submit(req.params.id, parsed.data.text)
    res.status(202).json({ ok: true })
  })

  r.get('/projects/:id/files', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    res.json({ tree: scanTree(proj.path) })
  })

  // 在项目内新建空文件 / 目录（Issue 15）。位置由前端给相对路径（当前选中目录 + 名字，无选中则项目根）。
  r.post('/projects/:id/create', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const b = req.body as { path?: unknown; kind?: unknown }
    const rel = typeof b?.path === 'string' ? b.path.trim() : ''
    const kind = b?.kind === 'dir' ? 'dir' : 'file'
    if (!rel) return res.status(400).json(apiErr('invalid_request', '缺少 path'))
    try { createEntry(proj.path, rel, kind); res.json({ ok: true, tree: scanTree(proj.path) }) }
    catch (e) {
      if (e instanceof FileAccessError) {
        if (e.reason === 'already_exists') return res.status(409).json(apiErr('already_exists', '同名文件/目录已存在'))
        return res.status(400).json(apiErr('invalid_request', e.reason === 'out_of_bounds' ? '路径越界' : e.reason))
      }
      throw e
    }
  })

  // 同目录改名（文件或目录）。body { path, newName }；newName 含分隔符 / 重名 / 越界由 renameEntry 兜底拒绝。
  // 返回新相对路径（供前端同步已打开 tab 的 key）+ 最新树。
  r.post('/projects/:id/rename', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const b = req.body as { path?: unknown; newName?: unknown }
    const rel = typeof b?.path === 'string' ? b.path.trim() : ''
    const newName = typeof b?.newName === 'string' ? b.newName.trim() : ''
    if (!rel || !newName) return res.status(400).json(apiErr('invalid_request', '缺少 path / newName'))
    try { const p = renameEntry(proj.path, rel, newName); res.json({ ok: true, path: p, tree: scanTree(proj.path) }) }
    catch (e) {
      if (e instanceof FileAccessError) {
        if (e.reason === 'already_exists') return res.status(409).json(apiErr('already_exists', '同名文件/目录已存在'))
        if (e.reason === 'not_found') return res.status(404).json(apiErr('not_found', '文件不存在'))
        return res.status(400).json(apiErr('invalid_request', e.reason === 'out_of_bounds' ? '路径越界' : e.reason === 'invalid_name' ? '名称非法' : e.reason))
      }
      throw e
    }
  })

  // 移动若干源到目标目录。body { paths, destDir }（destDir ''=项目根）；同名去重、跳过 no-op、禁移进自身子孙。
  r.post('/projects/:id/move', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const b = req.body as { paths?: unknown; destDir?: unknown }
    const paths = b?.paths
    if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string')) return res.status(400).json(apiErr('invalid_request', 'paths 必须是字符串数组'))
    const destDir = typeof b?.destDir === 'string' ? b.destDir : ''
    try { const moved = moveEntry(proj.path, paths as string[], destDir); res.json({ moved, tree: scanTree(proj.path) }) }
    catch (e) {
      if (e instanceof FileAccessError) {
        if (e.reason === 'not_found') return res.status(404).json(apiErr('not_found', '目标目录不存在'))
        return res.status(400).json(apiErr('invalid_request', e.reason === 'out_of_bounds' ? '路径越界' : e.reason === 'invalid_move' ? '非法移动（目标非目录或移入自身子目录）' : e.reason))
      }
      throw e
    }
  })

  // 项目目录变更推送（Issue 19）：fs.watch 项目根，文件增删改时发 files-changed（防抖 200ms 合并突发）。
  // renderer 收到后防抖重拉 api.files，覆盖一切来源（agent / 命令行 / 外部程序）。SSE 经 cookie 过门。
  r.get('/projects/:id/fs-stream', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(': connected\n\n')
    let timer: ReturnType<typeof setTimeout> | null = null
    const ping = () => {
      if (timer) return
      timer = setTimeout(() => { timer = null; res.write('event: files-changed\ndata: {}\n\n') }, 200)
    }
    let watcher: import('node:fs').FSWatcher | null = null
    try { watcher = fs.watch(proj.path, { recursive: true }, () => ping()) }
    catch { try { watcher = fs.watch(proj.path, () => ping()) } catch { /* watch 不可用 → 仅靠手动刷新兜底 */ } }
    req.on('close', () => { if (timer) clearTimeout(timer); watcher?.close() })
  })

  // 拖入文件/文件夹 → 复制进项目根目录。前端传一组源绝对路径（renderer 经 preload 的 webUtils.getPathForFile 取得）。
  r.post('/projects/:id/import-files', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const body = req.body as { paths?: unknown; dir?: unknown }
    const paths = body?.paths
    if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string')) {
      return res.status(400).json(apiErr('invalid_request', 'paths 必须是字符串数组'))
    }
    // dir：可选子目录（消息附件传 'attachments'；文件面板拖入不传=项目根）
    const dir = typeof body?.dir === 'string' ? body.dir : ''
    const imported = importFiles(proj.path, paths as string[], dir)
    res.json({ imported, tree: scanTree(proj.path) })
  })

  // 粘贴：剪贴板字节无源路径 → multipart 上传写进 <project>/attachments/（生成名见前端，防重名见 saveAttachmentBytes）
  const pasteUpload = multer({ storage: multer.memoryStorage() })
  r.post('/projects/:id/attachments/paste', pasteUpload.single('file'), (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const file = (req as express.Request & { file?: { buffer: Buffer; originalname?: string } }).file
    if (!file) return res.status(400).json(apiErr('invalid_request', '缺少文件'))
    const name = file.originalname || `pasted-${Date.now()}`
    const saved = saveAttachmentBytes(proj.path, 'attachments', name, file.buffer)
    res.json({ file: saved })
  })

  r.get('/projects/:id/file', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const rel = req.query.path
    if (typeof rel !== 'string' || rel.length === 0) return res.status(400).json(apiErr('invalid_request', '缺少 path 参数'))
    try { const out = readProjectFile(proj.path, rel); res.json({ path: rel, content: out.content, truncated: out.truncated }) }
    catch (e) {
      if (e instanceof FileAccessError) {
        if (e.reason === 'not_found') return res.status(404).json(apiErr('not_found', '文件不存在'))
        return res.status(400).json(apiErr('invalid_request', e.reason === 'out_of_bounds' ? '路径越界' : '不是文件'))
      }
      throw e
    }
  })

  // 项目文件字节流（供预览：图片 <img> / PDF·HTML <iframe src> / md 相对图 / 附件缩略图）。
  // 路径放在 URL path 段（/pf/:id/<相对路径>）而非 query，使 HTML 的相对子资源能按同源正确解析；
  // 越界校验复用 resolveProjectFile；Content-Type 由 res.sendFile 按扩展名推断，并原生支持 Range（PDF/视频）。
  r.get('/pf/:id/*', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const rel = (req.params as Record<string, string>)['0'] ?? ''
    if (!rel) return res.status(400).json(apiErr('invalid_request', '缺少文件路径'))
    try {
      const abs = resolveProjectFile(proj.path, rel)
      res.sendFile(abs)
    } catch (e) {
      if (e instanceof FileAccessError) {
        if (e.reason === 'not_found') return res.status(404).json(apiErr('not_found', '文件不存在'))
        return res.status(400).json(apiErr('invalid_request', e.reason === 'out_of_bounds' ? '路径越界' : '不是文件'))
      }
      throw e
    }
  })

  // 把项目内相对路径解析为安全磁盘绝对路径（供「在外部程序打开 / 复制绝对路径 / Finder 显示」）。
  // 用 resolveProjectPath（允许目录）：文件夹也要能取绝对路径，故不限定 isFile。
  r.get('/projects/:id/abs-path', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const rel = req.query.path
    if (typeof rel !== 'string' || rel.length === 0) return res.status(400).json(apiErr('invalid_request', '缺少 path 参数'))
    try { res.json({ absPath: resolveProjectPath(proj.path, rel) }) }
    catch (e) {
      if (e instanceof FileAccessError) {
        if (e.reason === 'not_found') return res.status(404).json(apiErr('not_found', '文件不存在'))
        return res.status(400).json(apiErr('invalid_request', e.reason === 'out_of_bounds' ? '路径越界' : e.reason))
      }
      throw e
    }
  })

  // 动态模型列表（claude）：用该会话活动 query 的 supportedModels()；无活会话 → models:null（前端回落静态列表）
  r.get('/sessions/:id/models', async (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    res.json({ models: await deps.runtime.supportedModels(req.params.id) })
  })

  // 动态命令列表（claude）：四态回落——活查询实时 / 会话桶 / cwd 探针兜底 / [] （不再 null）。
  r.get('/sessions/:id/commands', async (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    res.json({ commands: await deps.runtime.supportedCommands(req.params.id) })
  })

  // 项目级命令（无会话入口）：取 project.path 当 cwd → 走同一 cwd 探针缓存。供「项目已开、还没建会话」场景。
  r.get('/projects/:id/commands', async (req, res) => {
    if (!getProject(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '项目不存在'))
    res.json({ commands: await deps.runtime.projectCommands(req.params.id) })
  })

  r.get('/sessions/:id/status', (req, res) => {
    const sess = getSession(deps.db, req.params.id)
    if (!sess) return res.status(404).json(apiErr('not_found', '会话不存在'))
    res.json({ running: deps.runtime.isRunning(req.params.id), status: sess.status })
  })

  r.put('/projects/:id', (req, res) => {
    if (!getProject(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const name = (req.body as { name?: unknown })?.name
    if (typeof name !== 'string' || !name.trim()) return res.status(400).json(apiErr('invalid_request', '缺少 name'))
    renameProject(deps.db, req.params.id, name.trim())
    res.json({ ok: true })
  })

  // 修改项目属性（Part B T3）：当前仅支持 selectedAgent（项目级「下个新会话用哪个引擎」持久化选中值）。
  // 顺序：先 404（项目不存在） → 400（参数非法） → 写。
  r.patch('/projects/:id', (req, res) => {
    if (!getProject(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const parsed = PatchProjectReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '参数非法'))
    if (parsed.data.selectedAgent !== undefined) setProjectSelectedAgent(deps.db, req.params.id, parsed.data.selectedAgent)
    res.json({ ok: true })
  })

  // 硬删项目：先 dispose 项目下全部会话的运行时（停底层 query + 清内存，收尾回调被 disposed 守卫拦下），
  // 再级联删库（会话→messages/usage + 项目行），最后删项目目录文件（删盘失败不阻塞：库已删，列表不再出现）。
  r.delete('/projects/:id', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    for (const s of getSessionsByProject(deps.db, proj.id)) deps.runtime.dispose(s.id)
    deleteProject(deps.db, proj.id)
    try { fs.rmSync(proj.path, { recursive: true, force: true }) } catch { /* 删盘失败不阻塞 */ }
    res.json({ ok: true })
  })

  r.patch('/sessions/:id', (req, res) => {
    const sess = getSession(deps.db, req.params.id)
    if (!sess) return res.status(404).json(apiErr('not_found', '会话不存在'))
    const parsed = PatchSessionReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '参数非法'))
    const { pinned, title, engine, model } = parsed.data
    if (engine !== undefined) {
      const dir = deps.transcriptDir ?? sessionsDir()
      if (sessionHasMessages(dir, req.params.id)) return res.status(409).json(apiErr('conflict', '会话已发送，不可改引擎'))
      // 变身：更新 engine+model，并清空旧引擎专属档案（Part B T5a）。
      // refine 已保证 engine 在场时 model 必在场，`?? sess.model` 仅为类型完整（model 推断仍是 string|undefined），运行时不触达。
      changeSessionEngine(deps.db, req.params.id, engine, model ?? sess.model)
    }
    if (typeof pinned === 'boolean') setSessionPinned(deps.db, req.params.id, pinned)
    if (typeof title === 'string' && title.trim()) setSessionTitle(deps.db, req.params.id, title.trim())
    res.json({ ok: true })
  })

  // 真删除会话：先停底层 query + 清运行时内存（此后收尾回调被 disposed 守卫拦下，不再回写），再硬删 DB（会话行 + messages + usage）
  r.delete('/sessions/:id', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    deps.runtime.dispose(req.params.id)
    deleteSession(deps.db, req.params.id)
    res.json({ ok: true })
  })

  r.get('/sessions/:id/usage', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    res.json(sumUsage(deps.db, req.params.id))
  })

  r.get('/engines/detail', (_req, res) => {
    const found = deps.detect()
    const engines = (['claude', 'codex'] as const).map((name) => ({
      name, label: engineLabel(name), bin: found[name],
      version: found[name] ? detectEngineVersion(found[name]!) : null,
    }))
    res.json({ engines })
  })

  r.post('/engines/:name/test', (req, res) => {
    const name = req.params.name
    if (name !== 'claude' && name !== 'codex') return res.status(400).json(apiErr('invalid_request', '未知引擎'))
    const bin = deps.detect()[name]
    if (!bin) return res.json({ ok: false, version: null, message: '未检测到 CLI' })
    const version = detectEngineVersion(bin)
    res.json({ ok: version !== null, version, message: version ? undefined : 'CLI 调用失败' })
  })

  r.get('/skills', (_req, res) => { res.json({ skills: scanSkills(deps.readConfig().skillsDir) }) })

  r.post('/skills/install', async (req, res) => {
    const parsed = InstallSkillReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '安装参数非法'))
    try { res.json(await skills.installSkill(parsed.data)) } catch (e) { return skillErr(res, e) }
  })

  r.post('/skills/create', (req, res) => {
    const parsed = CreateSkillReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '创建参数非法'))
    try { res.json(skills.createSkill(parsed.data)) } catch (e) { return skillErr(res, e) }
  })

  // ===== 技能源模型端点（2026-06-05-skill-source-model-design）=====
  r.get('/skill-sources', (_req, res) => { res.json({ sources: skills.listSources().map(redactSource) }) })
  r.post('/skill-sources', (req, res) => {
    const parsed = AddSourceReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '源参数非法'))
    try { res.status(201).json({ source: redactSource(skills.addSource(parsed.data)) }) } catch (e) { return skillErr(res, e) }
  })
  r.patch('/skill-sources/:id', (req, res) => {
    const parsed = PatchSourceReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '源参数非法'))
    try { res.json({ source: redactSource(skills.patchSource(req.params.id, parsed.data)) }) } catch (e) { return skillErr(res, e) }
  })
  r.delete('/skill-sources/:id', (req, res) => {
    try { skills.removeSource(req.params.id); res.json({ ok: true }) } catch (e) { return skillErr(res, e) }
  })
  r.post('/skill-sources/reorder', (req, res) => {
    const parsed = ReorderSourcesReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '重排参数非法'))
    skills.reorderSources(parsed.data.order); res.json({ ok: true })
  })

  // ===== 技能分组端点（2026-06-07-skill-source-group-design）=====
  r.get('/skill-groups', (_req, res) => { res.json({ groups: skills.listGroups() }) })
  r.post('/skill-groups', (req, res) => {
    const parsed = AddGroupReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '分组参数非法'))
    try { res.status(201).json({ group: skills.addGroup(parsed.data) }) } catch (e) { return skillErr(res, e) }
  })
  r.patch('/skill-groups/:id', (req, res) => {
    const parsed = PatchGroupReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '分组参数非法'))
    try { res.json({ group: skills.patchGroup(req.params.id, parsed.data) }) } catch (e) { return skillErr(res, e) }
  })
  r.delete('/skill-groups/:id', (req, res) => {
    try { skills.removeGroup(req.params.id); res.json({ ok: true }) } catch (e) { return skillErr(res, e) }
  })
  r.post('/skill-groups/reorder', (req, res) => {
    const parsed = ReorderGroupsReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '重排参数非法'))
    skills.reorderGroups(parsed.data.order); res.json({ ok: true })
  })

  r.get('/skill-sources/:id/skills', (req, res) => {
    try { res.json({ skills: skills.probe(req.params.id) }) } catch (e) { return skillErr(res, e) }
  })
  r.get('/skill-sources/:id/skill-md', (req, res) => {
    const relPath = typeof req.query.relPath === 'string' ? req.query.relPath : ''
    try { res.json({ content: skills.readSkillMd(req.params.id, relPath) }) } catch (e) { return skillErr(res, e) }
  })
  r.post('/skill-sources/:id/reprobe', (req, res) => {
    try { res.json({ skills: skills.reprobe(req.params.id) }) } catch (e) { return skillErr(res, e) }
  })
  r.post('/skill-sources/:id/update-mode', (req, res) => {
    const parsed = UpdateMode.safeParse((req.body as { mode?: unknown })?.mode)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '档位非法'))
    try { res.json({ source: redactSource(skills.setUpdateMode(req.params.id, parsed.data)) }) } catch (e) { return skillErr(res, e) }
  })
  r.post('/skill-library/toggle', (req, res) => {
    const parsed = ToggleLibReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '入库参数非法'))
    try { skills.toggleLib(parsed.data.sourceId, parsed.data.relPath, parsed.data.inLib); res.json({ ok: true }) } catch (e) { return skillErr(res, e) }
  })
  r.get('/skill-library', (_req, res) => { res.json({ skills: skills.listLibrary() }) })
  r.post('/skill-library/auto-inject', (req, res) => {
    const parsed = SetAutoInjectReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '参数非法'))
    skills.setAutoInject(parsed.data.effectiveName, parsed.data.on); res.json({ ok: true })
  })

  // ── 技能精确探测（Agent 一次性产出 slots，不落盘；spec §5 精确层）──────────
  r.post('/skills/probe-config', async (req, res) => {
    const parsed = ProbeConfigReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '探测参数非法'))
    try {
      const creds = deps.providers.resolveActiveCreds('claude')
      const slots = await skills.agentProbe(parsed.data.sourceId, parsed.data.relPath, creds)
      res.json({ slots })
    } catch (e) { return skillErr(res, e) }
  })

  // ===== 命令行工具（CodePilot 化：检测即可见 + agent 装）=====
  // 目录 + 已装检测走 HTTP；安装/更新/查更新无 HTTP 路由（经 as_cli_* MCP 工具由 agent 触发）。
  r.get('/cli-tools/catalog', (_req, res) => { res.json({ tools: cliTools.catalog() }) })
  r.get('/cli-tools/installed', async (_req, res) => {
    try { res.json(await cliTools.installed()) }
    catch { res.status(500).json(apiErr('internal', 'CLI 工具检测失败')) }
  })
  r.post('/cli-tools/custom', async (req, res) => {
    const parsed = AddCustomCliToolReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '工具参数非法'))
    try { res.status(201).json({ tool: await cliTools.addCustom(parsed.data) }) }
    catch (e) { res.status(400).json(apiErr('invalid_request', e instanceof Error ? e.message : '登记失败')) }
  })
  r.delete('/cli-tools/custom/:id', (req, res) => { cliTools.removeCustom(req.params.id); res.json({ ok: true }) })

  r.get('/providers', (_req, res) => res.json(deps.providers.view()))

  r.post('/providers', (req, res) => {
    const parsed = CreateProviderReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', 'engine/name/baseUrl/apiKey 必填'))
    res.status(201).json({ provider: deps.providers.create(parsed.data) })
  })

  r.put('/providers/active', (req, res) => {
    const parsed = SetActiveProviderReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', 'engine/providerId 必填'))
    deps.providers.setActive(parsed.data.engine, parsed.data.providerId)
    res.json({ ok: true })
  })

  r.put('/providers/:id', (req, res) => {
    const parsed = UpdateProviderReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '参数非法'))
    const v = deps.providers.update(req.params.id, parsed.data)
    if (!v) return res.status(404).json(apiErr('not_found', 'Provider 不存在'))
    res.json({ provider: v })
  })

  r.delete('/providers/:id', (req, res) => {
    deps.providers.remove(req.params.id)
    res.json({ ok: true })
  })

  r.post('/providers/:id/test', async (req, res) => {
    const p = deps.providers.getStored(req.params.id)
    if (!p) return res.status(404).json(apiErr('not_found', 'Provider 不存在'))
    if (p.engine !== 'claude') return res.json({ ok: false, requestText: '', responseText: 'codex Provider 后置，暂不支持测试' })
    const model = typeof req.body?.model === 'string' ? req.body.model : undefined
    const result = await testClaudeProvider({ baseUrl: p.baseUrl, apiKey: p.apiKey, keyEnv: p.keyEnv }, { model })
    res.json(result)
  })

  // ── 命名密钥（secrets）──────────────────────────────────────────
  r.get('/secrets', (_req, res) => {
    // 「谁在用」合并两侧：技能（entityRef）+ Provider（Provider 名），按 secretId 倒排
    const skillUsage = deps.entityReqs.usageBySecret()      // secretId → entityRef[]
    const provUsage = deps.providers.usageBySecret()        // secretId → providerName[]
    const ids = new Set([...Object.keys(skillUsage), ...Object.keys(provUsage)])
    const usage: Record<string, { skills: string[]; providers: string[] }> = {}
    for (const id of ids) usage[id] = { skills: skillUsage[id] ?? [], providers: provUsage[id] ?? [] }
    res.json({ secrets: deps.secrets.view(), usage })
  })
  r.post('/secrets', (req, res) => {
    const parsed = CreateSecretReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '密钥参数非法'))
    res.status(201).json({ secret: deps.secrets.create(parsed.data) })
  })
  r.put('/secrets/:id', (req, res) => {
    const parsed = UpdateSecretReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '密钥参数非法'))
    const v = deps.secrets.update(req.params.id, parsed.data)
    if (!v) return res.status(404).json(apiErr('not_found', '密钥不存在'))
    res.json({ secret: v })
  })
  r.delete('/secrets/:id', (req, res) => {
    deps.secrets.remove(req.params.id)
    res.json({ ok: true })
  })

  // ── 凭证来源 (auth)：状态查询 + 设来源 + 设官网密钥引用 ──────────────
  const AUTH_ENGINES = ['claude', 'codex'] as const
  // claudeLogin / codexLogin 由 server.ts 注入为保证值（缺省层在 startDaemon 收敛，对齐 detect）——路由可测（不碰真实 keychain / ~/.codex）。
  const claudeLoginFn = deps.claudeLogin
  const codexLoginFn = deps.codexLogin
  // ClaudeLoginState / CodexLoginState → CliLoginStatus：两者字段同形，显式列举守住契约（不传递多余字段）。
  const mapCliLogin = (s: ClaudeLoginState | CodexLoginState): CliLoginStatus => {
    if (s.status === 'signed-out') return { status: 'signed-out' }
    if (s.method === 'oauth') return { status: 'signed-in', method: 'oauth', email: s.email }
    return { status: 'signed-in', method: 'api_key' }
  }
  r.get('/auth/status', (_req, res) => {
    const provs = deps.providers.view()
    const engines = {} as AuthStatusResp['engines']
    for (const e of AUTH_ENGINES) {
      const st = deps.authSources.get(e)
      // 各引擎走各自本机检测：claude 读 keychain/.credentials.json，codex 读 ~/.codex/auth.json（Part A P7：codex 不再恒 unknown）。
      const cliLogin: CliLoginStatus = mapCliLogin(e === 'claude' ? claudeLoginFn() : codexLoginFn())
      // app 内 OAuth 登录态从 token 库读（持久化在 auth.json）——使前端「已授权」显示能跨重开/切引擎保留
      const tok = deps.oauthTokens?.get(e)
      engines[e] = {
        activeSource: st.activeSource,
        officialKey: { secretId: st.officialKeySecretId },
        custom: provs.engines[e].providers.map((p) => p.id),
        cliLogin,
        oauth: { signedIn: !!tok?.accessToken, email: tok?.email },
        proxyBindings: st.proxyBindings ?? {},
      }
    }
    res.json({ engines })
  })
  r.put('/auth/source', (req, res) => {
    const parsed = SetAuthSourceReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '来源参数非法'))
    deps.authSources.setSource(parsed.data.engine, parsed.data.source)
    res.json({ ok: true })
  })
  r.put('/auth/official-key', (req, res) => {
    const parsed = SetOfficialKeyReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '密钥参数非法'))
    deps.authSources.setOfficialKey(parsed.data.engine, parsed.data.secretId)
    res.json({ ok: true })
  })

  // ── 代理 (proxy)：池 CRUD + 连通测试（mock）+ 来源绑定 ──────────────
  // 视图脱敏：list/create/update 一律回 toProxyView（绝不向 renderer 回明文 password）。
  r.get('/proxies', (_req, res) => { res.json({ proxies: deps.proxies.view() }) })
  r.post('/proxies', (req, res) => {
    const parsed = CreateProxyReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '代理参数非法'))
    const p = deps.proxies.create(parsed.data)
    res.status(201).json({ proxy: toProxyView(p) })
  })
  r.put('/proxies/:id', (req, res) => {
    const parsed = UpdateProxyReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '代理参数非法'))
    const p = deps.proxies.update(req.params.id, parsed.data)
    if (!p) return res.status(404).json(apiErr('not_found', '代理不存在'))
    res.json({ proxy: toProxyView(p) })
  })
  r.delete('/proxies/:id', (req, res) => {
    deps.proxies.remove(req.params.id)
    res.json({ ok: true })
  })
  r.post('/proxies/:id/test', (req, res) => {
    if (!deps.proxies.get(req.params.id)) return res.status(404).json(apiErr('not_found', '代理不存在'))
    // TODO: 真实 TCP/HTTP 探测延后；当前返回 mock
    res.json({ ok: true, latencyMs: 0 })
  })
  r.put('/auth/proxy', (req, res) => {
    const parsed = SetSourceProxyReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '绑定参数非法'))
    // proxyId 空串 → 解绑（=直连）
    deps.authSources.setProxy(parsed.data.engine, parsed.data.source, parsed.data.proxyId)
    res.json({ ok: true })
  })

  // ── app 内 OAuth 授权登录（Task 4.3：3 步粘码流）──────────────────
  // PKCE verifier 暂存：单用户本地 app，进程级内存 Map 足够（不持久化）。key=state。
  // 故意不设 TTL/清理：进程生命周期内有效；被放弃的授权流程会残留一条极小条目，直到 daemon 重启——可接受，无需过度设计。
  const oauthStash = new Map<string, { verifier: string; engine: Engine }>()
  r.post('/auth/oauth/start', (req, res) => {
    const parsed = StartOAuthReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '引擎参数非法'))
    const { verifier, challenge } = genPkce()
    const state = genState()
    oauthStash.set(state, { verifier, engine: parsed.data.engine })
    const authorizeUrl = buildAuthorizeUrl({ challenge, state })
    res.json({ authorizeUrl, state })
  })
  r.post('/auth/oauth/finish', async (req, res) => {
    const parsed = FinishOAuthReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '授权参数非法'))
    if (!deps.oauthTokens) return res.status(500).json(apiErr('internal', 'OAuth 令牌库未接入'))
    const { engine, code, state } = parsed.data
    const stashed = oauthStash.get(state)
    // state 不存在 / 引擎不匹配 → 会话失效（防重放、防错引擎）
    if (!stashed || stashed.engine !== engine) return res.status(400).json(apiErr('invalid_request', '授权会话失效，请重新发起'))
    try {
      const tokens = await exchangeCode({ code, verifier: stashed.verifier, state }, { fetch: deps.oauthFetch })
      deps.oauthTokens.set(engine, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt, email: tokens.email })
      oauthStash.delete(state)   // 一次性：换成功即作废，杜绝重放
      res.json({ email: tokens.email })
    } catch (e) {
      res.status(502).json(apiErr('upstream_error', e instanceof Error ? e.message : '换取 token 失败'))
    }
  })
  r.post('/auth/logout', (req, res) => {
    const parsed = LogoutReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '引擎参数非法'))
    deps.oauthTokens?.clear(parsed.data.engine)
    deps.authSources.setSource(parsed.data.engine, 'cli-login')   // 来源重置回默认
    res.json({ ok: true })
  })

  // ── codex app 内登录引导（P7.4：account/login/start 经 app-server 自管）──────────
  // chatgpt 流程异步：start 路由起 login 流程、回吐 authUrl + loginSessionId 后立即返回，
  // login Promise 挂在 stash 里继续跑（等浏览器授权完成的 completed 通知）；前端轮询 status 路由拿终态。
  // 进程级内存 Map（单用户本地 app 足够，不持久化）。done/error 落地后保留一小段供轮询读取，不主动清。
  type CodexLoginSession = { status: 'pending' | 'done' | 'error'; error?: string }
  const codexLoginSessions = new Map<string, CodexLoginSession>()
  r.post('/auth/codex/login', async (req, res) => {
    if (!deps.codexLoginStart) return res.status(501).json(apiErr('not_implemented', 'codex 登录引导未接入'))
    const parsed = CodexLoginReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '登录参数非法（apiKey 需带 apiKey）'))
    const params = parsed.data
    if (params.type === 'apiKey') {
      // 同步成功路径：等 login 跑完直接回 done
      try {
        await deps.codexLoginStart(params)
        return res.json({ done: true })
      } catch (e) {
        return res.status(502).json(apiErr('upstream_error', e instanceof Error ? e.message : 'codex 登录失败'))
      }
    }
    // chatgpt：起流程，等 authUrl 回吐后返回 loginSessionId；Promise 在后台等 completed。
    const loginSessionId = genState()
    codexLoginSessions.set(loginSessionId, { status: 'pending' })
    let answered = false
    const onAuthUrl = (authUrl: string): void => {
      if (answered) return
      answered = true
      res.json({ done: false, authUrl, loginSessionId })
    }
    deps.codexLoginStart(params, onAuthUrl).then(
      () => { codexLoginSessions.set(loginSessionId, { status: 'done' }) },
      (e: unknown) => {
        const msg = e instanceof Error ? e.message : String(e)
        codexLoginSessions.set(loginSessionId, { status: 'error', error: msg })
        // 兜底：login 在回吐 authUrl 前就失败（reject 早于 onAuthUrl）→ 直接回错误响应，不挂死请求。
        if (!answered) { answered = true; res.status(502).json(apiErr('upstream_error', msg)) }
      },
    )
  })
  r.get('/auth/codex/login/:loginSessionId', (req, res) => {
    const s = codexLoginSessions.get(req.params.loginSessionId)
    if (!s) return res.status(404).json(apiErr('not_found', '登录会话不存在'))
    res.json({ status: s.status, ...(s.error ? { error: s.error } : {}) })
  })

  // ── 实体需求清单（entity-requirements）──────────────────────────
  r.get('/entity-requirements', (_req, res) => {
    res.json({ requirements: deps.entityReqs.all() })
  })
  r.put('/entity-requirements/:ref', (req, res) => {
    const parsed = PutEntityRequirementReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '需求参数非法'))
    deps.entityReqs.put(decodeURIComponent(req.params.ref), parsed.data)
    res.json({ ok: true })
  })

  // ── 项目缺配/冲突检查（不回明文，仅结论）──────────────────────────
  r.get('/projects/:id/skill-config-check', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const refs = listInjectedSkills(proj.path).map((n) => 'skill:' + n)
    const { conflicts, missing } = resolveSkillEnv(deps.entityReqs, deps.secrets, refs)
    res.json({ conflicts, missing })
  })

  // ── 按技能集查冲突/缺配（无 projectId，建项目前预检；spec §4/§7 门②）──────────
  r.post('/skill-config-check', (req, res) => {
    const parsed = SkillConfigCheckReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '参数非法'))
    const refs = parsed.data.skills.map((n: string) => 'skill:' + n)
    const { conflicts, missing } = resolveSkillEnv(deps.entityReqs, deps.secrets, refs)
    res.json({ conflicts, missing })
  })

  r.get('/sessions/:id/stream', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
    res.write(': connected\n\n')   // 立即冲刷响应头，让客户端确认连接
    const unsub = deps.runtime.subscribe(req.params.id, (ev) => {
      res.write(`event: ${ev.type}\ndata: ${JSON.stringify(ev)}\n\n`)
    })
    req.on('close', () => { unsub() })
  })

  // ── 提醒配置（Reminders）──────────────────────────────────────────
  // GET /projects/:id/reminders → 返回项目提醒配置（无文件返回默认 enabled:false）
  r.get('/projects/:id/reminders', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    res.json(readProjectReminders(proj.path))
  })

  // PUT /projects/:id/reminders → 写项目提醒配置（严格校验，非法 → 400）
  r.put('/projects/:id/reminders', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const parsed = RemindersConfig.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '提醒配置非法'))
    writeProjectReminders(proj.path, parsed.data)
    res.json(parsed.data)
  })

  // GET /reminders/default → 读全局默认提醒配置
  r.get('/reminders/default', (_req, res) => {
    res.json(readDefaultReminders())
  })

  // PUT /reminders/default → 写全局默认提醒配置
  r.put('/reminders/default', (req, res) => {
    const parsed = RemindersConfig.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '提醒配置非法'))
    writeDefaultReminders(parsed.data)
    res.json(parsed.data)
  })

  // ── 音频上传 / 回放 ──────────────────────────────────────────────
  const ALLOWED_SOUND_EXTS = new Set(['mp3', 'wav', 'ogg', 'm4a'])
  const MAX_SOUND_BYTES = 5 * 1024 * 1024   // 5 MB

  // 音效 Content-Type 映射（按扩展名，sendFile 会自动推断，但为安全明确设置）
  const SOUND_CONTENT_TYPES: Record<string, string> = {
    mp3: 'audio/mpeg',
    wav: 'audio/wav',
    ogg: 'audio/ogg',
    m4a: 'audio/mp4',
  }

  // multer：存内存，上传后再写盘（便于大小检验 + 安全路径处理）
  const soundUpload = multer({ storage: multer.memoryStorage() })

  // POST /projects/:id/reminders/sounds → 上传音频文件
  r.post('/projects/:id/reminders/sounds', soundUpload.single('file'), (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))

    const file = (req as express.Request & { file?: { buffer: Buffer; originalname?: string; size: number } }).file
    if (!file) return res.status(400).json(apiErr('invalid_request', '缺少音频文件'))

    // 大小校验
    if (file.size > MAX_SOUND_BYTES) {
      return res.status(400).json(apiErr('file_too_large', `音频文件不得超过 5MB，当前 ${file.size} bytes`))
    }

    // 扩展名校验（大小写不敏感）
    const origName = file.originalname || 'sound'
    const ext = path.extname(origName).slice(1).toLowerCase()
    if (!ALLOWED_SOUND_EXTS.has(ext)) {
      return res.status(400).json(apiErr('invalid_ext', `不支持的扩展名 .${ext}，允许：mp3/wav/ogg/m4a`))
    }

    // 安全文件名处理：取 basename 防路径穿越，保留扩展名
    const safeName = path.basename(origName)

    // 建目录并写盘
    const soundsDir = projectSoundsDir(proj.path)
    fs.mkdirSync(soundsDir, { recursive: true })

    // 去重：同名时加时间戳后缀
    let destName = safeName
    if (fs.existsSync(path.join(soundsDir, destName))) {
      const ts = Date.now()
      destName = `${path.basename(safeName, path.extname(safeName))}-${ts}${path.extname(safeName)}`
    }

    fs.writeFileSync(path.join(soundsDir, destName), file.buffer)

    // 返回相对项目路径（对齐 contracts sound.file 格式）
    const relFile = `.agent-shell/sounds/${destName}`
    res.json({ file: relFile })
  })

  // GET /projects/:id/reminders/sounds/:name → 读取并返回音频字节
  r.get('/projects/:id/reminders/sounds/:name', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))

    // 防路径穿越：名字必须等于 basename（无目录分隔符）
    const rawName = req.params.name
    const safeName = path.basename(rawName)
    if (safeName !== rawName || rawName.includes('/') || rawName.includes('\\') || rawName.includes('..')) {
      return res.status(400).json(apiErr('invalid_request', '文件名非法（路径穿越）'))
    }

    const soundsDir = projectSoundsDir(proj.path)
    const target = path.resolve(soundsDir, safeName)

    // 二次校验：解析后路径必须仍在 soundsDir 内
    if (!target.startsWith(path.resolve(soundsDir) + path.sep) && target !== path.resolve(soundsDir)) {
      return res.status(400).json(apiErr('invalid_request', '路径越界'))
    }

    if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
      return res.status(404).json(apiErr('not_found', '音频文件不存在'))
    }

    const ext = path.extname(safeName).slice(1).toLowerCase()
    const contentType = SOUND_CONTENT_TYPES[ext] ?? 'application/octet-stream'
    res.setHeader('Content-Type', contentType)
    res.sendFile(target)
  })

  return r
}
