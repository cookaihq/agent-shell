import path from 'node:path'
import { spawn } from 'node:child_process'
import type Database from 'better-sqlite3'
import type { AgentEvent, AutomationRunStatus, AutomationRunTrigger } from '@agent-shell/contracts'
import { getProject } from '../db/projects'
import { createSession } from '../db/sessions'
import { insertRun, updateRun } from '../db/automations'
import type { AutomationRow, AutomationStore } from './automationStore'
import { injectAutomationAssets } from './injectAssets'
import type { SessionRuntime } from '../session/sessionRuntime'
import { createProjectWithSkills } from '../projects/createWithSkills'

/** run handler 完成事件回调（通知用，Phase 8）。 */
export interface AutomationRunDone {
  runId: string
  automationId: string
  automationName: string
  projectId: string
  sessionId: string
  status: AutomationRunStatus
  summary: string | null
  error: string | null
}

export interface RunHandlerDeps {
  db: Database.Database
  runtime: SessionRuntime
  /** 文件态仓库：读任务定义（agent 路径 a.prompt 已含在 row 内，store 供一致来源）。 */
  store: AutomationStore
  /** readConfig().projectsDir —— create_each_run 时在此父目录下建项目。 */
  resolveProjectsDir: () => string
  /** readConfig().skillsDir —— create_each_run 时注入默认技能集用。 */
  resolveSkillsDir: () => string
  /** readConfig().automationsDir —— 注入任务自带脚本/reference + script executor 解析脚本入口。 */
  resolveAutomationsDir: () => string
  /** run 结束回调（成功/失败/needs-review 都会调）；Phase 8 通知通路订阅它。 */
  onRunDone?: (done: AutomationRunDone) => void
}

/** 无人值守护栏（§4.2）：拼到 prompt 前面，禁反问 + 告知只读 assets 路径。claude/codex 通用。 */
export function guardrail(name: string, folderName: string): string {
  return (
    `【无人值守任务护栏】你正在执行一个定时自动化任务「${name}」，没有人在旁边盯着。\n` +
    `不要反问、不要调用 AskUserQuestion、不要等待用户确认或输入。遇到不确定的地方，挑一个合理的默认值继续，把任务做完。\n` +
    `本任务自带的脚本/参考资料在只读目录 \`automation-assets/${folderName}/\`（相对当前工作目录），可读取/执行；产物请写到工作目录，勿写回该只读目录。\n\n` +
    `任务指令如下：\n`
  )
}

/** 时间戳（用于新项目/会话标题）。固定格式，不依赖 locale。 */
function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

interface RunOutcome { status: AutomationRunStatus; summary: string | null; error: string | null }

/**
 * 订阅会话事件、提交护栏 prompt，等本轮 turn_end 收尾，把结果归一成 run 状态。
 * 无人值守关键护栏：见到 ask_user_question / permission_request（超权限档）→ 立即 deny（防永久挂起）+ 标 needs-review。
 */
function runUnattended(runtime: SessionRuntime, sessionId: string, a: AutomationRow): Promise<RunOutcome> {
  return new Promise<RunOutcome>((resolve) => {
    let needsReview = false
    let reviewReason: string | null = null
    let settled = false
    const finish = (o: RunOutcome) => {
      if (settled) return
      settled = true
      unsub()
      resolve(o)
    }
    const unsub = runtime.subscribe(sessionId, (ev: AgentEvent) => {
      switch (ev.type) {
        case 'ask_user_question':
          needsReview = true
          reviewReason = '触发了 AskUserQuestion，无人值守不接受交互（已拒绝并标记待复核）'
          runtime.resolveDecision(sessionId, ev.requestId, { behavior: 'deny', message: '无人值守任务，不接受交互' })
          break
        case 'permission_request':
          needsReview = true
          reviewReason = `工具 ${ev.toolName} 需要授权，超出该自动化的权限档（已拒绝并标记待复核）`
          runtime.resolveDecision(sessionId, ev.requestId, { behavior: 'deny', message: '无人值守任务，超出权限档' })
          break
        case 'turn_end': {
          const stop = ev.stopReason
          if (needsReview) finish({ status: 'needs-review', summary: reviewReason, error: null })
          else if (stop === 'failed') finish({ status: 'failed', summary: null, error: ev.detail ?? '运行失败' })
          else if (stop === 'aborted') finish({ status: 'canceled', summary: null, error: ev.detail ?? '被中止' })
          else finish({ status: 'succeeded', summary: null, error: null })
          break
        }
      }
    })
    // 护栏 + 指令；claude 透传 permissionMode，codex 透传 sandbox（两者都存在 automation.permission 列里）
    const prompt = guardrail(a.name, a.id) + a.prompt
    const cfg = a.engine === 'claude' ? { permissionMode: a.permission } : { sandbox: a.permission }
    runtime.submit(sessionId, prompt, [], cfg)
  })
}

/**
 * executor=script 直跑（spec §16.2）：spawn 子进程跑脚本，捕获 stdout/stderr/exit code，
 * 不建会话、不发护栏、不经 LLM。脚本是 app 信任的本地代码（V1 不沙箱）。exit 0=成功。
 */
function runScript(deps: RunHandlerDeps, a: AutomationRow, cwd: string): Promise<RunOutcome> {
  return new Promise<RunOutcome>((resolve) => {
    if (!a.script) { resolve({ status: 'failed', summary: null, error: 'executor=script 但未指定 script 入口' }); return }
    const scriptPath = path.join(deps.resolveAutomationsDir(), a.id, a.script)
    // interpreter：显式优先；否则按扩展名推断（.mjs/.js/.cjs→node，.sh→bash，.py→python3）
    const ext = path.extname(a.script).toLowerCase()
    const interp = a.interpreter ?? ({ '.mjs': 'node', '.js': 'node', '.cjs': 'node', '.sh': 'bash', '.py': 'python3' }[ext] ?? 'node')
    let stdout = ''; let stderr = ''
    const child = spawn(interp, [scriptPath], { cwd, env: process.env })
    child.stdout.on('data', (d) => { stdout += String(d) })
    child.stderr.on('data', (d) => { stderr += String(d) })
    child.on('error', (err) => resolve({ status: 'failed', summary: null, error: `脚本启动失败: ${err.message}` }))
    child.on('close', (code) => {
      const tail = (s: string) => s.length > 2000 ? s.slice(-2000) : s   // 截尾，避免 run 行膨胀
      if (code === 0) resolve({ status: 'succeeded', summary: tail(stdout) || null, error: null })
      else resolve({ status: 'failed', summary: tail(stdout) || null, error: `exit ${code}\n${tail(stderr)}` })
    })
  })
}

/**
 * 构造调度器的 run handler：到点 → 解析 target 建项目 → 注入 assets → 按 executor 分流
 * （agent：建会话跑无人值守 prompt / script：spawn 直跑）→ 收尾写 automation_runs。
 * agent 路径一条运行 = 一条普通会话（只是无人值守），产出可在工作区回看。
 */
export function makeAutomationRunHandler(deps: RunHandlerDeps): (a: AutomationRow, trigger: AutomationRunTrigger) => Promise<void> {
  return async (a, trigger) => {
    const startedAt = Date.now()

    // 1. 解析目标项目
    let projectId: string
    if (a.target.mode === 'reuse') {
      const proj = getProject(deps.db, a.target.projectId)
      if (!proj) {
        // 目标项目已删 → 直接记一条 failed run（无会话）
        insertRun(deps.db, { automationId: a.id, trigger, status: 'failed', projectId: a.target.projectId, startedAt })
        return
      }
      projectId = proj.id
    } else {
      const proj = createProjectWithSkills(
        { db: deps.db, projectsDir: deps.resolveProjectsDir(), skillsDir: deps.resolveSkillsDir() },
        `${a.name} · ${stamp(startedAt)}`,
      )
      projectId = proj.id
    }

    // 2. 解析项目对象（拿 path：注入 assets + script cwd 都要）
    const proj = getProject(deps.db, projectId)!

    // 3. 注入任务自带脚本/reference（两种 executor 都做：script 也可能引用同文件夹内别的脚本/数据）
    injectAutomationAssets(proj.path, path.join(deps.resolveAutomationsDir(), a.id), a.id)

    // 4a. executor=script：spawn 直跑，不建会话（run 行 sessionId 留空）
    if (a.executor === 'script') {
      const run = insertRun(deps.db, { automationId: a.id, trigger, status: 'running', projectId, startedAt })
      let outcome: RunOutcome
      try { outcome = await runScript(deps, a, proj.path) }
      catch (err) { outcome = { status: 'failed', summary: null, error: err instanceof Error ? err.message : String(err) } }
      updateRun(deps.db, run.id, { status: outcome.status, completedAt: Date.now(), summary: outcome.summary, error: outcome.error })
      deps.onRunDone?.({ runId: run.id, automationId: a.id, automationName: a.name, projectId, sessionId: '', status: outcome.status, summary: outcome.summary, error: outcome.error })
      return
    }

    // 4b. agent 路径：建会话（claude 透传权限档；title 带时间戳）
    const sess = createSession(deps.db, {
      projectId, engine: a.engine, model: a.model,
      title: `${a.name} · ${stamp(startedAt)}`,
      ...(a.engine === 'claude' ? { permissionMode: a.permission } : {}),
    })

    // 占位 run 行（running）
    const run = insertRun(deps.db, { automationId: a.id, trigger, status: 'running', projectId, sessionId: sess.id, startedAt })

    // 跑无人值守
    let outcome: RunOutcome
    try {
      outcome = await runUnattended(deps.runtime, sess.id, a)
    } catch (err) {
      outcome = { status: 'failed', summary: null, error: err instanceof Error ? err.message : String(err) }
    }

    // 收尾
    updateRun(deps.db, run.id, {
      status: outcome.status, completedAt: Date.now(), summary: outcome.summary, error: outcome.error,
    })
    deps.onRunDone?.({
      runId: run.id, automationId: a.id, automationName: a.name, projectId, sessionId: sess.id,
      status: outcome.status, summary: outcome.summary, error: outcome.error,
    })
  }
}
