import express from 'express'
import type Database from 'better-sqlite3'
import {
  CreateAutomationReq, PatchAutomationReq, ClaudePermissionMode,
  type ApiError, type AutomationDTO, type AutomationRunDTO,
} from '@agent-shell/contracts'
import {
  createAutomation, getAutomation, listAutomations, patchAutomation, deleteAutomation,
  listRunsByAutomation, lastRunOf, type AutomationRow, type AutomationRunRow,
} from '../db/automations'
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
    id: a.id, name: a.name, prompt: a.prompt, engine: a.engine, model: a.model, permission: a.permission,
    categories: a.categories, schedule: a.schedule, target: a.target, enabled: a.enabled,
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
  scheduler: AutomationScheduler
  /** 订阅 run 结束事件（SSE 路由用）。 */
  onRunDone: (fn: (d: AutomationRunDone) => void) => () => void
}

/** /automations 路由组（spec §8）。挂进主 router。 */
export function createAutomationRouter(deps: AutomationRouterDeps): express.Router {
  const r = express.Router()

  r.get('/automations', (_req, res) => {
    res.json({ automations: listAutomations(deps.db).map((a) => toAutomationDTO(deps.db, a)) })
  })

  r.post('/automations', (req, res) => {
    const parsed = CreateAutomationReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '自动化参数非法'))
    if (!validatePermission(parsed.data.engine, parsed.data.permission)) {
      return res.status(400).json(apiErr('invalid_request', '权限档与引擎不匹配'))
    }
    const a = createAutomation(deps.db, parsed.data)
    if (a.enabled) deps.scheduler.reschedule(a.id)   // 排定时器（写 nextRunAt）
    res.status(201).json({ automationId: a.id })
  })

  r.patch('/automations/:id', (req, res) => {
    if (!getAutomation(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '自动化不存在'))
    const parsed = PatchAutomationReq.safeParse(req.body)
    if (!parsed.success) return res.status(400).json(apiErr('invalid_request', '自动化参数非法'))
    if (parsed.data.engine && parsed.data.permission && !validatePermission(parsed.data.engine, parsed.data.permission)) {
      return res.status(400).json(apiErr('invalid_request', '权限档与引擎不匹配'))
    }
    const updated = patchAutomation(deps.db, req.params.id, parsed.data)!
    // 改了启停 / 调度 → 重排（reschedule 内部对 enabled=false 取消并清 nextRunAt）
    if (parsed.data.enabled !== undefined || parsed.data.schedule !== undefined) deps.scheduler.reschedule(updated.id)
    res.json({ automation: toAutomationDTO(deps.db, updated) })
  })

  r.delete('/automations/:id', (req, res) => {
    if (!getAutomation(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '自动化不存在'))
    deps.scheduler.cancel(req.params.id)   // 取消定时器
    deleteAutomation(deps.db, req.params.id)
    res.json({ ok: true })
  })

  r.post('/automations/:id/run', (req, res) => {
    if (!getAutomation(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '自动化不存在'))
    void deps.scheduler.runNow(req.params.id)   // 后台跑，不阻塞响应
    res.status(202).json({ ok: true })
  })

  r.get('/automations/:id/runs', (req, res) => {
    if (!getAutomation(deps.db, req.params.id)) return res.status(404).json(apiErr('not_found', '自动化不存在'))
    res.json({ runs: listRunsByAutomation(deps.db, req.params.id).map(toRunDTO) })
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
