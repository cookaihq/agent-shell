import { spawn as nodeSpawn } from 'node:child_process'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { AgentEvent, Engine } from '@agent-shell/contracts'
import { runTurn, type RuntimeTurnHandle } from '../runtimes/scheduler'
import { runClaudeSdkTurn, type ClaudeSdkHandle, type ClaudeSdkDecision, type ClaudeQueryFn } from '../runtimes/claudeSdk'
import { getRuntimeDef } from '../runtimes/registry'
import { getSession, setSessionStatus, setResumableId, setSessionVersions } from '../db/sessions'

const SDK_VERSION: string | undefined = (() => {
  try {
    const req = createRequire(import.meta.url)
    let dir = path.dirname(req.resolve('@anthropic-ai/claude-agent-sdk'))
    for (let i = 0; i < 8; i++) {
      const pj = path.join(dir, 'package.json')
      if (fs.existsSync(pj)) {
        const j = JSON.parse(fs.readFileSync(pj, 'utf8')) as { name?: string; version?: string }
        if (j.name === '@anthropic-ai/claude-agent-sdk') return j.version
      }
      const parent = path.dirname(dir)
      if (parent === dir) break
      dir = parent
    }
  } catch { /* best-effort */ }
  return undefined
})()
import { getProject } from '../db/projects'
import { recordUsage } from '../db/usage'
import type { SessionStatus } from '../db/types'
import { truncateEvent, TRUNCATE_LIMIT } from './truncate'
import { resolveAttachments, buildPromptWithAttachments } from './attachments'
import { appendRecord, sessionsDir } from './transcript'

/** 一次 submit 可携带的运行时档位（UI 权限/思考强度）+ 可选结构化输出；省略则沿用会话当前值。 */
export interface RuntimeConfig {
  permissionMode?: string
  effort?: string
  /** 模型（claude SDK 别名/变体）：运行中走 setModel 热切换；两轮间记下，下个新 query 起时生效。 */
  model?: string
  /** 结构化输出（json_schema）：在新 query 起时生效（不能 mid-query 热切）。 */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }
}

export interface SessionRuntimeDeps {
  db: Database.Database
  resolveBin: (engine: Engine) => string
  spawnFn?: typeof nodeSpawn
  /** 注入假 SDK query（测试）；省略则 ClaudeSdkRuntime 走真实 SDK。 */
  claudeQueryFn?: ClaudeQueryFn
  /** claude idle 看门狗超时（ms，turn 内卡死判定）；省略默认 5 分钟。测试可注入短值。 */
  claudeIdleTimeoutMs?: number
  /** claude 持久 query 空闲关闭超时（ms，两轮间存活上限）；省略默认 10 分钟。测试可注入短值。 */
  claudeSessionIdleMs?: number
  truncateLimit?: number
  /** transcript 落盘目录；省略用 sessionsDir()。测试注入临时目录。 */
  transcriptDir?: string
}

/** 排队的续投消息：prompt 已拼好 preamble；dirs=该消息引用的项目外授权目录（决定能否在同进程 pushUser）。 */
interface QueuedMsg { prompt: string; dirs: string[] }

interface SessionState {
  engine: Engine
  model: string
  cwd: string
  running: boolean
  /** 会话已被销毁（删除）：置 true 后所有 onEvent/onTurnEnd/onDone 回调一律 no-op，绝不再回写 DB（防 interrupt 异步收尾写孤儿）。 */
  disposed: boolean
  queue: QueuedMsg[]
  handle?: RuntimeTurnHandle
  /** claude 专属句柄（含 resolveDecision/setPermissionMode/rewindFiles 等交互+控制能力）；codex 为 undefined。 */
  claudeHandle?: ClaudeSdkHandle
  turn: number                              // 已完成 turn 数
  resumableId: string | null
  /** 当前/最近一次 spawn 进程被授权读取的项目外目录（累积；决定排队消息能否同进程续投）。 */
  grantedDirs: string[]
  /** 当前权限档位（claude）：起 query 传入；运行中变更走 setPermissionMode 热切。默认 default。 */
  permissionMode: string
  /** 当前思考强度（claude effort）：起 query 传入；运行中变更走 applyFlagSettings 热切。 */
  effort?: string
  /** 结构化输出（claude）：起 query 时透传 query.outputFormat。 */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }
  /** claude 持久 query 是否存活（两轮间保活——让 rewindFiles/续投/热切换在回合后仍可用）。codex 恒 false。 */
  queryAlive: boolean
  /** 空闲关闭计时器：query 存活但无新一轮，超时则 endInput 优雅关闭，避免空闲进程长留。 */
  idleTimer?: ReturnType<typeof setTimeout>
  subscribers: Set<(ev: AgentEvent) => void>
  blocks: unknown[]                         // 本 turn 累积的 assistant 内容块
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
}

/** failed/aborted 原样落库，其余（end_turn/completed/max_tokens…）→ completed。 */
function mapStatus(stopReason: string): SessionStatus {
  if (stopReason === 'failed') return 'failed'
  if (stopReason === 'aborted') return 'aborted'
  return 'completed'
}

export class SessionRuntime {
  private states = new Map<string, SessionState>()
  constructor(private deps: SessionRuntimeDeps) {}

  private load(sessionId: string): SessionState {
    let st = this.states.get(sessionId)
    if (st) return st
    const sess = getSession(this.deps.db, sessionId)
    if (!sess) throw new Error(`session not found: ${sessionId}`)
    const proj = getProject(this.deps.db, sess.projectId)
    if (!proj) throw new Error(`project not found: ${sess.projectId}`)
    st = {
      engine: sess.engine, model: sess.model, cwd: proj.path,
      running: false, disposed: false, queue: [], turn: 0, resumableId: sess.resumableId,
      grantedDirs: [], permissionMode: 'default', queryAlive: false, subscribers: new Set(), blocks: [],
    }
    this.states.set(sessionId, st)
    return st
  }

  isRunning(sessionId: string): boolean {
    return this.states.get(sessionId)?.running ?? false
  }

  subscribe(sessionId: string, fn: (ev: AgentEvent) => void): () => void {
    const st = this.load(sessionId)
    st.subscribers.add(fn)
    return () => st.subscribers.delete(fn)
  }

  interrupt(sessionId: string): void {
    const st = this.states.get(sessionId)
    if (!st) return
    this.clearIdleTimer(st)
    if (!st.running) {
      // 无活动轮但 claude query 仍空闲存活 → 关掉它（用户主动停止会话）
      if (st.queryAlive) { st.handle?.endInput(); st.queryAlive = false }
      return
    }
    st.queue.length = 0          // 中断 = 放弃排队的续投
    st.handle?.interrupt()        // 合成 turn_end(aborted)
  }

  /**
   * 销毁会话运行时（删除会话用）：同步停掉底层 query（运行中→interrupt 中断当前轮；仅空闲存活→endInput 优雅关），
   * 并从内存摘除、置 disposed。此后 interrupt 异步收尾触发的 onTurnEnd/onDone 会被 disposed 守卫拦下，
   * 绝不再往（即将被删除的）会话回写 messages/usage/status —— 根治孤儿数据。
   */
  dispose(sessionId: string): void {
    const st = this.states.get(sessionId)
    if (!st) return
    st.disposed = true
    this.clearIdleTimer(st)
    st.subscribers.clear()
    const wasRunning = st.running
    st.queue.length = 0
    this.states.delete(sessionId)
    try {
      if (wasRunning) st.handle?.interrupt()
      else if (st.queryAlive) st.handle?.endInput()
    } catch { /* 停止底层 query 失败不阻塞删除 */ }
  }

  submit(sessionId: string, text: string, contextFiles: string[] = [], runtime?: RuntimeConfig): void {
    const st = this.load(sessionId)
    // 应用本次提交携带的运行时档位：未运行→存起来下轮 query 生效；运行中→对 claude 活会话热切换
    this.applyRuntimeConfig(st, runtime)
    // 分类附件路径：项目内→相对、项目外→绝对+授权目录；不存在的丢弃
    const { listed, externalDirs } = resolveAttachments(st.cwd, contextFiles)
    // user 提问写进 transcript（取代 messages 表写入）：原文 + 附件
    appendRecord(this.deps.transcriptDir ?? sessionsDir(), sessionId, st.engine, 'user_prompt', { text, attachments: listed })
    // 引擎 prompt 才带 preamble；排队也存拼好的 prompt + 其授权目录
    const promptText = buildPromptWithAttachments(text, listed)
    if (st.running) { st.queue.push({ prompt: promptText, dirs: externalDirs }); return }
    // claude 持久 query 空闲存活 → 复用同 query 续投（无需重 spawn / resume），前提：本消息引用的外部目录都已授权
    if (st.engine === 'claude' && st.queryAlive && st.claudeHandle) {
      this.clearIdleTimer(st)
      if (externalDirs.every((d) => st.grantedDirs.includes(d))) {
        st.running = true; st.blocks = []; st.usage = undefined
        st.grantedDirs = [...new Set([...st.grantedDirs, ...externalDirs])]
        st.claudeHandle.pushUser(promptText)
        return
      }
      // 引用了新外部目录 → 关掉空闲 query，排队，onDone 起带新 --add-dir 的新 query（沿用 resumable_id）
      st.claudeHandle.endInput(); st.queryAlive = false; st.running = true
      st.queue.push({ prompt: promptText, dirs: externalDirs })
      return
    }
    this.startTurn(sessionId, st, promptText, externalDirs)
  }

  private clearIdleTimer(st: SessionState): void { if (st.idleTimer) { clearTimeout(st.idleTimer); st.idleTimer = undefined } }
  /** query 存活但空闲 → 起关闭计时，超时 endInput 优雅退出（→ onDone 收尾），避免空闲进程长留。 */
  private startIdleTimer(st: SessionState): void {
    this.clearIdleTimer(st)
    st.idleTimer = setTimeout(() => { st.handle?.endInput() }, this.deps.claudeSessionIdleMs ?? 600_000)
  }

  /** 更新会话运行时档位。运行中且为 claude → 对活 query 热切换（setPermissionMode / applyFlagSettings effort）。 */
  setRuntimeConfig(sessionId: string, runtime: RuntimeConfig): void {
    this.applyRuntimeConfig(this.load(sessionId), runtime)
  }

  private applyRuntimeConfig(st: SessionState, runtime?: RuntimeConfig): void {
    if (!runtime) return
    // 持久 query 下两轮间（running=false 但 queryAlive）也能热切换 → 用 queryAlive 判定
    if (runtime.permissionMode !== undefined && runtime.permissionMode !== st.permissionMode) {
      st.permissionMode = runtime.permissionMode
      if (st.queryAlive) void st.claudeHandle?.setPermissionMode(runtime.permissionMode as never)
    }
    if (runtime.effort !== undefined && runtime.effort !== st.effort) {
      st.effort = runtime.effort
      if (st.queryAlive) void st.claudeHandle?.setEffort(runtime.effort)
    }
    if (runtime.model !== undefined && runtime.model !== st.model) {
      st.model = runtime.model
      if (st.queryAlive) void st.claudeHandle?.setModel(runtime.model)
    }
    // outputFormat 不能 mid-query 热切——只记下，下个新 query 起时生效
    if (runtime.outputFormat !== undefined) st.outputFormat = runtime.outputFormat
  }

  /** 解决一个挂起的授权/提问（renderer 回执 → /sessions/:id/decision）。非 claude 或无活会话静默忽略。 */
  resolveDecision(sessionId: string, requestId: string, decision: ClaudeSdkDecision): void {
    this.states.get(sessionId)?.claudeHandle?.resolveDecision(requestId, decision)
  }

  /** 文件检查点回退（claude）。userMessageId 省略 → 回退到最近一次检查点。无活会话/非 claude/无检查点 → canRewind:false。 */
  async rewindFiles(sessionId: string, userMessageId: string | undefined, opts?: { dryRun?: boolean }) {
    const h = this.states.get(sessionId)?.claudeHandle
    if (!h) return { canRewind: false, error: '无活动的 Claude 会话' }
    const id = userMessageId || h.lastCheckpointId()
    if (!id) return { canRewind: false, error: '无可回退的检查点' }
    return h.rewindFiles(id, opts)
  }

  /** 动态模型列表（claude）：活动 query 拉 supportedModels() 并缓存；无活会话 → 返回缓存（首个会话跑过后即有）。
   *  从未跑过任何 claude 会话 → null（前端回落静态列表）。这样模型列表「动态拉取替硬编码」在首会话后全局生效。 */
  private claudeModelsCache: Array<{ value: string; displayName: string; description: string }> | null = null
  async supportedModels(sessionId: string) {
    const h = this.states.get(sessionId)?.claudeHandle
    if (h) {
      const m = await h.supportedModels()
      if (m && m.length) this.claudeModelsCache = m as typeof this.claudeModelsCache
    }
    return this.claudeModelsCache
  }

  private startTurn(sessionId: string, st: SessionState, prompt: string, addDirs: string[] = []): void {
    st.running = true
    st.blocks = []
    st.usage = undefined
    // 累积授权目录：新进程拿到本会话至今所有外部目录，减少后续重 spawn
    st.grantedDirs = [...new Set([...st.grantedDirs, ...addDirs])]
    const onEvent = (ev: AgentEvent) => this.onEvent(st, ev)
    const onTurnEnd = (stopReason: string) => this.onTurnEnd(sessionId, st, stopReason)
    const onResumableId = (id: string) => { st.resumableId = id; setResumableId(this.deps.db, sessionId, id) }
    const onInit = (info: { sessionId: string; claudeCodeVersion?: string }) =>
      setSessionVersions(this.deps.db, sessionId, { claudeCodeVersion: info.claudeCodeVersion, sdkVersion: SDK_VERSION })
    const onRawMessage = (msg: unknown) =>
      appendRecord(this.deps.transcriptDir ?? sessionsDir(), sessionId, st.engine, (msg as any)?.type ?? 'unknown', msg)

    if (st.engine === 'claude') {
      // Claude 走 SDK 常驻 query：权限档/思考强度真生效（接 §3 真链路）；addDirs→additionalDirectories；
      // 队列/续投/中断/收尾沿用同一 onTurnEnd/onDone（SDK handle 与 CLI handle 同形）。
      const handle = runClaudeSdkTurn({
        cwd: st.cwd,
        model: st.model,
        prompt,
        permissionMode: st.permissionMode as never,
        effort: st.effort,
        addDirs: st.grantedDirs,
        resumableId: st.resumableId ?? undefined,
        enableFileCheckpointing: true,   // 开检查点 → 支持 rewindFiles 文件回退
        ...(st.outputFormat ? { outputFormat: st.outputFormat } : {}),   // 结构化输出透传
        idleTimeoutMs: this.deps.claudeIdleTimeoutMs ?? 300_000,   // idle 看门狗：5 分钟无响应判卡死
        queryFn: this.deps.claudeQueryFn,
        onEvent, onTurnEnd, onResumableId, onRawMessage, onInit,
      })
      st.handle = handle
      st.claudeHandle = handle
      st.queryAlive = true   // 持久 query：起后保活，直到 endInput/interrupt/idle 关闭
      void handle.done.then(() => this.onDone(sessionId, st))
      return
    }

    // Codex 维持 CLI spawn 现状不动
    const handle = runTurn({
      engine: st.engine,
      binPath: this.deps.resolveBin(st.engine),
      cwd: st.cwd,
      model: st.model,
      prompt,
      addDirs: st.grantedDirs,
      resumableId: st.resumableId ?? undefined,
      spawnFn: this.deps.spawnFn,
      onEvent, onTurnEnd, onResumableId,
    })
    st.handle = handle
    st.claudeHandle = undefined
    void handle.done.then(() => this.onDone(sessionId, st))
  }

  private onEvent(st: SessionState, raw: AgentEvent): void {
    if (st.disposed) return   // 会话已删除：丢弃迟到事件，不推送、不累积
    const ev = truncateEvent(raw, this.deps.truncateLimit ?? TRUNCATE_LIMIT)
    for (const fn of st.subscribers) fn(ev)
    switch (ev.type) {
      // 落库 block 用 type:'text'（与 user 文本块、M5 messages 约定、MVP spec 一致；内部事件类型是 message，但块语义=纯文本）
      case 'message': st.blocks.push({ type: 'text', text: ev.text }); break
      case 'thinking': st.blocks.push({ type: 'thinking', text: ev.text, ...(ev.elapsedMs !== undefined ? { elapsedMs: ev.elapsedMs } : {}) }); break
      case 'tool_use': st.blocks.push({ type: 'tool_use', id: ev.id, name: ev.name, input: ev.input }); break
      case 'tool_result': st.blocks.push({ type: 'tool_result', toolUseId: ev.toolUseId, ok: ev.ok, content: ev.content }); break
      case 'usage': st.usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: ev.costUsd }; break
      case 'turn_end': break   // 落库在 onTurnEnd 统一做
    }
  }

  private onTurnEnd(sessionId: string, st: SessionState, stopReason: string): void {
    if (st.disposed) return   // 会话已删除：interrupt 异步收尾到此为止，绝不回写 messages/usage/status
    const db = this.deps.db
    const turnNo = st.turn + 1
    if (st.usage) {
      recordUsage(db, { sessionId, turn: turnNo, ...st.usage })
    }
    setSessionStatus(db, sessionId, mapStatus(stopReason))
    st.turn = turnNo
    // 把组装好的 assistant blocks 写一条 transcript 记录作渲染源（含真思考；保证历史===实时）。
    // claude 同时有 onRawMessage 原始流（调试/取 msg_id 用），但渲染统一以此为准。
    if (st.blocks.length > 0) {
      appendRecord(this.deps.transcriptDir ?? sessionsDir(), sessionId, st.engine, 'assistant_blocks', { blocks: st.blocks })
    }
    st.blocks = []
    st.usage = undefined
    // claude 持久 query（turnBoundary='event'）：本轮结束后**保活**（不 endInput）→ 让 rewindFiles/续投/热切换在回合后仍可用。
    if (getRuntimeDef(st.engine).turnBoundary === 'event') {
      if (stopReason === 'aborted') {
        st.queue.length = 0                       // 中断：query 正被 interrupt 杀，交 onDone 收尾
      } else if (stopReason === 'failed') {
        st.queue.length = 0; st.running = false   // 失败：放弃续投；query 保活，下次 submit 复用
        if (st.queryAlive) this.startIdleTimer(st)
      } else {
        const next = st.queue[0]                  // 先 peek 不 shift
        if (!next) {
          st.running = false                      // 队列空 → 不 endInput！持久 query 保活，running 归 false，起空闲关闭计时
          this.startIdleTimer(st)
        } else if (next.dirs.every((d) => st.grantedDirs.includes(d))) {
          st.queue.shift(); st.handle?.pushUser(next.prompt)   // 授权够 → 同 query 续投
        } else {
          st.handle?.endInput()                   // 引用了新外部目录 → 排空，留队列交 onDone 起新 query 换 --add-dir
        }
      }
    }
  }

  private onDone(sessionId: string, st: SessionState): void {
    if (st.disposed) return   // 会话已删除：句柄收尾由 dispose 负责，这里不再续投/改状态
    // query 真正退出（endInput→完成 / 中断 / 崩溃）→ 清句柄与存活态、计时器
    st.handle = undefined
    st.claudeHandle = undefined
    st.queryAlive = false
    this.clearIdleTimer(st)
    const next = st.queue.shift()
    if (next !== undefined) {
      // 队列有残留 → 起新进程 resume 投递：codex 正常续投；claude 是排空窗口/新外部目录场景。两引擎都用 st.resumableId，不丢消息。
      this.startTurn(sessionId, st, next.prompt, next.dirs)
    } else {
      st.running = false
    }
  }
}
