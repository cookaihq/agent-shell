import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import type Database from 'better-sqlite3'
import { CreateProjectReq, CreateSessionReq, SubmitMessageReq, ResumeReq, DecisionReq, RuntimeConfigReq, RewindReq, type ApiError, type AppConfig } from '@agent-shell/contracts'
import { createProject, getProject, listProjectsWithStatus, renameProject, uuid32 } from '../db/projects'
import { createSession, getSession, getSessionsByProject, setSessionPinned, setSessionTitle, setSessionRuntime, deleteSession } from '../db/sessions'
import { scanTree, readProjectFile, resolveProjectFile, importFiles, saveAttachmentBytes, createEntry, FileAccessError } from './files'
import { sumUsage } from '../db/usage'
import { sessionsDir, readRecords, transcriptToMessages } from '../session/transcript'
import type { SessionRuntime } from '../session/sessionRuntime'
import { detectEngineVersion, engineLabel } from '../runtimes/engineInfo'
import { checkEngineUpdates } from '../runtimes/updateCheck'
import { scanSkills, importGitSkill, importFolderSkill, removeSkill, updateSkill, SkillError } from '../skills/store'
import { injectClaudeSkills } from '../skills/inject'
import { ImportSkillReq } from '@agent-shell/contracts'

export interface ApiDeps {
  db: Database.Database
  runtime: SessionRuntime
  readConfig: () => AppConfig
  writeConfig: (p: Partial<AppConfig>) => AppConfig
  detect: () => Record<'claude' | 'codex', string | null>
  transcriptDir?: string
}

const apiErr = (code: string, message: string): ApiError => ({ error: { code, message } })

export function createApiRouter(deps: ApiDeps): express.Router {
  const r = express.Router()

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

  r.get('/projects', (_req, res) => {
    res.json({ projects: listProjectsWithStatus(deps.db, (id) => deps.runtime.isRunning(id)) })
  })

  r.get('/config', (_req, res) => { res.json(deps.readConfig()) })
  r.put('/config', (req, res) => {
    const b = req.body as { projectsDir?: unknown; skillsDir?: unknown; debugMode?: unknown }
    const patch: Partial<AppConfig> = {}
    if (typeof b?.projectsDir === 'string' && b.projectsDir.trim()) patch.projectsDir = b.projectsDir.trim()
    if (typeof b?.skillsDir === 'string' && b.skillsDir.trim()) patch.skillsDir = b.skillsDir.trim()
    if (typeof b?.debugMode === 'boolean') patch.debugMode = b.debugMode
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
    res.json({ sessions: getSessionsByProject(deps.db, req.params.id) })
  })

  r.get('/sessions/:id/messages', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    const dir = deps.transcriptDir ?? sessionsDir()
    const recs = readRecords(dir, req.params.id)
    res.json({ messages: transcriptToMessages(req.params.id, recs) })
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

  // 把项目内相对路径解析为安全磁盘绝对路径（供「在外部程序打开」）。
  r.get('/projects/:id/abs-path', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const rel = req.query.path
    if (typeof rel !== 'string' || rel.length === 0) return res.status(400).json(apiErr('invalid_request', '缺少 path 参数'))
    try { res.json({ absPath: resolveProjectFile(proj.path, rel) }) }
    catch (e) {
      if (e instanceof FileAccessError) {
        if (e.reason === 'not_found') return res.status(404).json(apiErr('not_found', '文件不存在'))
        return res.status(400).json(apiErr('invalid_request', e.reason === 'out_of_bounds' ? '路径越界' : '不是文件'))
      }
      throw e
    }
  })

  // 动态模型列表（claude）：用该会话活动 query 的 supportedModels()；无活会话 → models:null（前端回落静态列表）
  r.get('/sessions/:id/models', async (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    res.json({ models: await deps.runtime.supportedModels(req.params.id) })
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

  r.post('/skills/import', (req, res) => {
    const parsed = ImportSkillReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '导入参数非法'))
    const { skillsDir } = deps.readConfig()
    try {
      const skill = parsed.data.source === 'git'
        ? importGitSkill(skillsDir, parsed.data.url ?? '')
        : importFolderSkill(skillsDir, parsed.data.path ?? '')
      res.status(201).json({ skill })
    } catch (e) {
      if (e instanceof SkillError) return res.status(400).json(apiErr(e.reason, e.message))
      throw e
    }
  })
  r.delete('/skills/:name', (req, res) => {
    try { removeSkill(deps.readConfig().skillsDir, req.params.name); res.json({ ok: true }) }
    catch (e) { if (e instanceof SkillError) return res.status(404).json(apiErr(e.reason, e.message)); throw e }
  })
  r.post('/skills/:name/update', (req, res) => {
    try { res.json({ skill: updateSkill(deps.readConfig().skillsDir, req.params.name) }) }
    catch (e) { if (e instanceof SkillError) return res.status(400).json(apiErr(e.reason, e.message)); throw e }
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
