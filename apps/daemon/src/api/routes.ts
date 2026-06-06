import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import type Database from 'better-sqlite3'
import { CreateProjectReq, CreateSessionReq, SubmitMessageReq, ResumeReq, DecisionReq, RuntimeConfigReq, RewindReq, InjectSkillsReq, type ApiError, type AppConfig, CreateProviderReq, UpdateProviderReq, SetActiveProviderReq, scheduleSummary } from '@agent-shell/contracts'
import { automationOriginsBySession } from '../db/automations'
import type { ProviderStore } from '../providers/store'
import { createProject, deleteProject, getProject, listProjectsWithStatus, renameProject, uuid32 } from '../db/projects'
import { createSession, getSession, getSessionsByProject, setSessionPinned, setSessionTitle, setSessionRuntime, deleteSession } from '../db/sessions'
import { scanTree, readProjectFile, resolveProjectFile, resolveProjectPath, importFiles, saveAttachmentBytes, createEntry, renameEntry, moveEntry, FileAccessError } from './files'
import { sumUsage } from '../db/usage'
import { sessionsDir, readRecords } from '../session/transcript'
import type { SessionRuntime } from '../session/sessionRuntime'
import { detectEngineVersion, engineLabel } from '../runtimes/engineInfo'
import { checkEngineUpdates } from '../runtimes/updateCheck'
import { scanSkills, SkillError } from '../skills/store'
import { injectClaudeSkills } from '../skills/inject'
import { AddSourceReq, PatchSourceReq, ReorderSourcesReq, ToggleLibReq, UpdateMode, AddCliToolReq, CliDetectReq, type SkillSourceDef } from '@agent-shell/contracts'
import { makeSkillService } from '../skills/service'
import { makeCliToolService } from '../clitools/service'
import { skillSourcesPath, skillSrcCacheDir } from '../paths'
import { testClaudeProvider } from '../providers/testConnectivity'
import { createAutomationRouter } from './automations'
import type { AutomationScheduler } from '../automation/scheduler'
import type { AutomationRunDone } from '../automation/runHandler'

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
  /** 定时自动化调度器（/automations 路由 + 启停重排）。 */
  scheduler: AutomationScheduler
  /** 订阅自动化 run 结束事件（→ /automations/events SSE，桌面壳系统通知）。 */
  onRunDone: (fn: (d: AutomationRunDone) => void) => () => void
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
  )
  const skillErr = (res: express.Response, e: unknown) => {
    if (e instanceof SkillError) return res.status(e.reason === 'not_found' ? 404 : 400).json(apiErr(e.reason, e.message))
    throw e
  }

  const cliTools = makeCliToolService(() => deps.readConfig().skillsDir, deps.cliToolsPath)

  // 定时自动化路由组（spec §8）
  r.use(createAutomationRouter({ db: deps.db, scheduler: deps.scheduler, onRunDone: deps.onRunDone }))

  r.post('/projects', (req, res) => {
    const parsed = CreateProjectReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '缺少 name'))
    const id = uuid32()          // 目录名 = id（对齐 spec）
    const projectPath = path.join(deps.readConfig().projectsDir, id)
    fs.mkdirSync(projectPath, { recursive: true })
    const proj = createProject(deps.db, { id, name: parsed.data.name, path: projectPath })
    injectClaudeSkills(projectPath, deps.readConfig().skillsDir, parsed.data.skills)
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
    const b = req.body as { projectsDir?: unknown; skillsDir?: unknown; debugMode?: unknown; engineModels?: unknown }
    const patch: Partial<AppConfig> = {}
    if (typeof b?.projectsDir === 'string' && b.projectsDir.trim()) patch.projectsDir = b.projectsDir.trim()
    if (typeof b?.skillsDir === 'string' && b.skillsDir.trim()) patch.skillsDir = b.skillsDir.trim()
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
    const origins = automationOriginsBySession(deps.db)
    const sessions = getSessionsByProject(deps.db, req.params.id).map((s) => {
      const o = origins.get(s.id)
      return o
        ? { ...s, origin: 'automation' as const, automationId: o.automationId, automationName: o.automationName, scheduleSummary: scheduleSummary(o.schedule), automationRunStatus: o.runStatus }
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
    const { text, contextFiles, permissionMode, effort, model, outputFormat } = parsed.data
    // 运行时档位（claude 权限/思考强度/模型/结构化输出）随消息携带：未运行下轮 query 生效，运行中热切换（outputFormat 仅新 query 生效）
    const runtime = (permissionMode !== undefined || effort !== undefined || model !== undefined || outputFormat !== undefined) ? { permissionMode, effort, model, outputFormat } : undefined
    // 持久化会话级档位（Issue 13/29）：随消息带的权限/思考强度/模型落库，重开会话回填
    if (permissionMode !== undefined || effort !== undefined || model !== undefined) setSessionRuntime(deps.db, req.params.id, { permissionMode, effort, model })
    deps.runtime.submit(req.params.id, text, contextFiles, runtime)
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
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    const b = req.body as { pinned?: unknown; title?: unknown }
    if (typeof b?.pinned === 'boolean') setSessionPinned(deps.db, req.params.id, b.pinned)
    if (typeof b?.title === 'string' && b.title.trim()) setSessionTitle(deps.db, req.params.id, b.title.trim())
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

  // 进执行模式页时异步查 CLI 最新版（npm registry，结果缓存 1h）。本地探测的 /engines/detail 保持快，
  // 联网查最新版另开此条，不拖慢首屏。查不到返回 latestVersion=null，前端静默不提示。
  r.get('/engines/updates', async (_req, res) => {
    res.json({ updates: await checkEngineUpdates() })
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

  // ===== 命令行工具市场（Issue 13 · 借鉴 CodePilot）=====
  r.get('/cli-tools', (_req, res) => { res.json({ tools: cliTools.list() }) })
  r.post('/cli-tools', (req, res) => {
    const parsed = AddCliToolReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '工具参数非法'))
    res.status(201).json({ tool: cliTools.add(parsed.data) })   // 持久化 + 生成 SKILL.md 入技能库（→ 可注入）
  })
  r.delete('/cli-tools/:id', (req, res) => { cliTools.remove(req.params.id); res.json({ ok: true }) })
  r.post('/cli-detect', (req, res) => {
    const parsed = CliDetectReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '检测参数非法'))
    res.json({ detected: cliTools.detect(parsed.data.names) })   // 复用 detectBinary（PATH/NVM/Homebrew + --version）
  })

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

  return r
}
