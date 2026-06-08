import express from 'express'
import type Database from 'better-sqlite3'
import {
  CreateAutomationReq, PatchAutomationReq, PutAutomationCategoriesReq, ClaudePermissionMode,
  type ApiError, type AutomationDTO, type AutomationRunDTO,
} from '@agent-shell/contracts'
import { listRunsByAutomation, lastRunOf, type AutomationRunRow } from '../db/automations'
import type { AutomationStore, AutomationRow } from '../automation/automationStore'
import { readCategories, writeCategories } from '../automation/automationCategories'
import type { AutomationScheduler } from '../automation/scheduler'
import type { AutomationRunDone } from '../automation/runHandler'

const apiErr = (code: string, message: string): ApiError => ({ error: { code, message } })

const CODEX_SANDBOXES = ['read-only', 'workspace-write', 'danger-full-access']
/** 按引擎校验 permission：claude ∈ ClaudePermissionMode（5 档）/ codex ∈ 沙箱 3 档。 */
function validatePermission(engine: 'claude' | 'codex', permission: string): boolean {
  return engine === 'claude' ? ClaudePermissionMode.safeParse(permission).success : CODEX_SANDBOXES.includes(permission)
}

function toAutomationDTO(db: Database.Database, a: AutomationRow): AutomationDTO {
  return {
    id: a.id, name: a.name, description: a.description, prompt: a.prompt, engine: a.engine, model: a.model, permission: a.permission,
    category: a.category, tags: a.tags, requires: a.requires, triggers: a.triggers,
    executor: a.executor, script: a.script, interpreter: a.interpreter,
    target: a.target, enabled: a.enabled,
    nextRunAt: a.nextRunAt, createdAt: a.createdAt, updatedAt: a.updatedAt,
    lastRun: lastRunOf(db, a.id),
  }
}
const toRunDTO = (r: AutomationRunRow): AutomationRunDTO => ({
  id: r.id, automationId: r.automationId, trigger: r.trigger, status: r.status,
  projectId: r.projectId, sessionId: r.sessionId, startedAt: r.startedAt, completedAt: r.completedAt,
  summary: r.summary, error: r.error,
})

export interface AutomationRouterDeps {
  db: Database.Database
  store: AutomationStore
  scheduler: AutomationScheduler
  /** 分类树存储文件路径（automation-categories.json）。 */
  automationCategoriesPath: string
  /** 订阅 run 结束事件（SSE 路由用）。 */
  onRunDone: (fn: (d: AutomationRunDone) => void) => () => void
}

/** /automations 路由组（spec §8）。挂进主 router。定义读写走文件态 store，运行历史仍读 db。 */
export function createAutomationRouter(deps: AutomationRouterDeps): express.Router {
  const r = express.Router()

  r.get('/automations', (_req, res) => {
    res.json({ automations: deps.store.list().map((a) => toAutomationDTO(deps.db, a)) })
  })

  r.post('/automations', (req, res) => {
    const parsed = CreateAutomationReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '自动化参数非法'))
    if (!validatePermission(parsed.data.engine, parsed.data.permission)) {
      return res.status(400).json(apiErr('invalid_request', '权限档与引擎不匹配'))
    }
    const a = deps.store.create(parsed.data)
    if (a.enabled) deps.scheduler.reschedule(a.id)   // 排定时器（写 nextRunAt）
    res.status(201).json({ automationId: a.id })
  })

  r.patch('/automations/:id', (req, res) => {
    if (!deps.store.get(req.params.id)) return res.status(404).json(apiErr('not_found', '自动化不存在'))
    const parsed = PatchAutomationReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '自动化参数非法'))
    if (parsed.data.engine && parsed.data.permission && !validatePermission(parsed.data.engine, parsed.data.permission)) {
      return res.status(400).json(apiErr('invalid_request', '权限档与引擎不匹配'))
    }
    const updated = deps.store.patch(req.params.id, parsed.data)!
    // 改了启停 / 触发器 → 重排（reschedule 内部对 enabled=false 取消并清 nextRunAt）
    if (parsed.data.enabled !== undefined || parsed.data.triggers !== undefined) deps.scheduler.reschedule(updated.id)
    res.json({ automation: toAutomationDTO(deps.db, updated) })
  })

  r.delete('/automations/:id', (req, res) => {
    if (!deps.store.get(req.params.id)) return res.status(404).json(apiErr('not_found', '自动化不存在'))
    deps.scheduler.cancel(req.params.id)   // 取消定时器
    deps.store.delete(req.params.id)
    res.json({ ok: true })
  })

  r.post('/automations/:id/run', (req, res) => {
    if (!deps.store.get(req.params.id)) return res.status(404).json(apiErr('not_found', '自动化不存在'))
    void deps.scheduler.runNow(req.params.id)   // 后台跑，不阻塞响应
    res.status(202).json({ ok: true })
  })

  r.get('/automations/:id/runs', (req, res) => {
    if (!deps.store.get(req.params.id)) return res.status(404).json(apiErr('not_found', '自动化不存在'))
    res.json({ runs: listRunsByAutomation(deps.db, req.params.id).map(toRunDTO) })
  })

  // 分类树（Plan D D6）：管理分类模态读写。GET 缺文件回 {tree:[]}；PUT 校验后整树覆盖。
  r.get('/automation-categories', (_req, res) => {
    res.json(readCategories(deps.automationCategoriesPath))
  })
  r.put('/automation-categories', (req, res) => {
    const parsed = PutAutomationCategoriesReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '分类树参数非法'))
    writeCategories(deps.automationCategoriesPath, parsed.data.tree)
    res.json({ ok: true })
  })

  // run 结束事件流（§7）：桌面壳订阅 → 跑完/失败/needs-review 弹系统通知。经 token gate（桌面壳带 auth header）。
  r.get('/automations/events', (req, res) => {
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive' })
    res.write(': connected\n\n')
    const unsub = deps.onRunDone((d) => { res.write(`event: run-done\ndata: ${JSON.stringify(d)}\n\n`) })
    req.on('close', () => { unsub() })
  })

  return r
}
