import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import type Database from 'better-sqlite3'
import { CreateProjectReq, CreateSessionReq, SubmitMessageReq, ResumeReq, type ApiError, type AppConfig } from '@agent-shell/contracts'
import { createProject, getProject, listProjectsWithStatus, renameProject, uuid32 } from '../db/projects'
import { createSession, getSession, getSessionsByProject, setSessionPinned, setSessionTitle } from '../db/sessions'
import { scanTree, readProjectFile, importFiles, FileAccessError } from './files'
import { getMessages } from '../db/messages'
import { sumUsage } from '../db/usage'
import type { SessionRuntime } from '../session/sessionRuntime'
import { detectEngineVersion, engineLabel } from '../runtimes/engineInfo'
import { scanSkills, importGitSkill, importFolderSkill, removeSkill, updateSkill, SkillError } from '../skills/store'
import { injectClaudeSkills } from '../skills/inject'
import { ImportSkillReq } from '@agent-shell/contracts'

export interface ApiDeps {
  db: Database.Database
  runtime: SessionRuntime
  readConfig: () => AppConfig
  writeConfig: (p: Partial<AppConfig>) => AppConfig
  detect: () => Record<'claude' | 'codex', string | null>
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
    const b = req.body as { projectsDir?: unknown; skillsDir?: unknown }
    const patch: Partial<AppConfig> = {}
    if (typeof b?.projectsDir === 'string' && b.projectsDir.trim()) patch.projectsDir = b.projectsDir.trim()
    if (typeof b?.skillsDir === 'string' && b.skillsDir.trim()) patch.skillsDir = b.skillsDir.trim()
    res.json(deps.writeConfig(patch))
  })

  r.post('/sessions', (req, res) => {
    const parsed = CreateSessionReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '会话参数非法'))
    if (!getProject(deps.db, parsed.data.projectId)) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const sess = createSession(deps.db, parsed.data)
    res.status(201).json({ sessionId: sess.id })
  })

  r.get('/projects/:id/sessions', (req, res) => {
    res.json({ sessions: getSessionsByProject(deps.db, req.params.id) })
  })

  r.get('/sessions/:id/messages', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    res.json({ messages: getMessages(deps.db, req.params.id) })
  })

  r.post('/sessions/:id/messages', (req, res) => {
    if (!getSession(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '会话不存在'))
    const parsed = SubmitMessageReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '消息参数非法'))
    deps.runtime.submit(req.params.id, parsed.data.text)   // contextFiles 留 M7 组装，此处不读
    res.status(202).json({ ok: true })
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

  // 拖入文件/文件夹 → 复制进项目根目录。前端传一组源绝对路径（renderer 经 preload 的 webUtils.getPathForFile 取得）。
  r.post('/projects/:id/import-files', (req, res) => {
    const proj = getProject(deps.db, req.params.id)
    if (!proj) return res.status(404).json(apiErr('not_found', '项目不存在'))
    const paths = (req.body as { paths?: unknown })?.paths
    if (!Array.isArray(paths) || paths.some(p => typeof p !== 'string')) {
      return res.status(400).json(apiErr('invalid_request', 'paths 必须是字符串数组'))
    }
    const imported = importFiles(proj.path, paths as string[])
    res.json({ imported, tree: scanTree(proj.path) })
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
