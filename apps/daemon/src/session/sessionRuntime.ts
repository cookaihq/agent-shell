import { spawn as nodeSpawn } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { createRequire } from 'node:module'
import fs from 'node:fs'
import path from 'node:path'
import type Database from 'better-sqlite3'
import type { AgentEvent, Engine } from '@agent-shell/contracts'
import { runClaudeSdkTurn, type ClaudeSdkHandle, type ClaudeSdkDecision, type ClaudeQueryFn } from '../runtimes/claudeSdk'
import { runCodexAppServerTurn, type CodexAppServerHandle, type CodexClientFactoryOpts, type CodexClientLike } from '../runtimes/codex/codexAppServer'
import { buildCliToolsContext } from '../clitools/context'
import { probeClaudeCommands } from '../runtimes/claudeCommandProbe'
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
import { resolveAttachments, buildPromptWithAttachments, appendCurrentFile } from './attachments'
import { inlineImages, type ImageInlineBlock } from './imageInline'
import { appendRecord, sessionsDir, collapseStreamingText } from './transcript'

/** 一次 submit 可携带的运行时档位（UI 权限/思考强度）+ 可选结构化输出；省略则沿用会话当前值。 */
export interface RuntimeConfig {
  permissionMode?: string
  /** codex 沙箱档（read-only/workspace-write/danger-full-access）：app-server 不走热切 setter，记下下个新 turn/start 起生效。 */
  sandbox?: string
  /** codex 审批档（untrusted/on-request/never）：app-server 不走热切 setter，记下下个新 turn/start 起生效。 */
  approval?: string
  effort?: string
  /** 模型（claude SDK 别名/变体）：运行中走 setModel 热切换；两轮间记下，下个新 query 起时生效。 */
  model?: string
  /** 结构化输出（json_schema）：在新 query 起时生效（不能 mid-query 热切）。 */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }
}

export interface SessionRuntimeDeps {
  db: Database.Database
  resolveBin: (engine: Engine) => string
  /** 自带版 codex 的 codex-path 目录（含 ripgrep `rg`）：prepend 进 codex app-server 的 PATH。省略=不补（测试免依赖真二进制）。 */
  resolveCodexPathDir?: () => string | undefined
  /** codex create_automation stdio MCP server bundle 绝对路径；有则 app-server spawn 注入 -c mcp_servers.automation.*（§10）。 */
  automationMcpEntry?: string
  spawnFn?: typeof nodeSpawn
  /** 注入假 SDK query（测试）；省略则 ClaudeSdkRuntime 走真实 SDK。 */
  claudeQueryFn?: ClaudeQueryFn
  /** 注入假 codex app-server client 工厂（测试）；省略则走真 CodexJsonRpcClient（spawn 真 codex app-server）。 */
  codexClientFactory?: (opts: CodexClientFactoryOpts) => CodexClientLike
  /** claude idle 看门狗超时（ms，turn 内卡死判定）；省略默认 5 分钟。测试可注入短值。 */
  claudeIdleTimeoutMs?: number
  /** claude 持久 query 空闲关闭超时（ms，两轮间存活上限）；省略默认 10 分钟。测试可注入短值。 */
  claudeSessionIdleMs?: number
  truncateLimit?: number
  /** transcript 落盘目录；省略用 sessionsDir()。测试注入临时目录。 */
  transcriptDir?: string
  /** 解析某引擎「当前 Provider」的注入凭证；省略=永不注入（默认登录态）。 */
  resolveCreds?: (engine: Engine) => import('../runtimes/types').ProviderCreds | undefined
  /** 解析某引擎当前来源的代理意图（三态：cli-login 继承 ambient / 受管直连 / 受管 url）；省略=不动代理变量。 */
  resolveProxy?: (engine: Engine) => import('../proxy/resolveProxy').ActiveProxy
  /** 解析某项目本次 run 激活技能的 env（技能密钥）；入参=项目 cwd；省略=永不注入。 */
  resolveSkillEnv?: (projectPath: string) => Record<string, string>
  /** run 启动前物化某项目激活技能的 file 槽位（写库目录 / external-path 软链）；入参=项目 cwd；省略=不物化。 */
  materializeSkillFiles?: (projectPath: string) => void
  /** in-process install_skill 工具回调（透传给 claude turn 挂 MCP）；省略=不挂。 */
  installSkill?: (req: import('@agent-shell/contracts').InstallSkillReq) => Promise<import('@agent-shell/contracts').InstallSkillResult>
  /** in-process create_skill 工具回调（透传给 claude turn 挂 MCP）；省略=不挂（install 或 create 任一存在则挂）。 */
  createSkill?: (req: import('@agent-shell/contracts').CreateSkillReq) => import('@agent-shell/contracts').CreateSkillResult | Promise<import('@agent-shell/contracts').CreateSkillResult>
  /** in-process create_automation 工具回调（透传给 claude turn 挂 as_create_automation）；省略=不挂。 */
  createAutomation?: (args: unknown) => Promise<{ content: { type: 'text'; text: string }[]; isError?: boolean }>
  /** cli-tools service 句柄：turn 起处算已装工具上下文 + 透传给 claude turn 挂 as_cli_* MCP；省略=不挂。 */
  cli?: import('../clitools/service').CliToolService
  /** 注入命令探针（测试）；省略则用真实 probeClaudeCommands（零成本空 prompt 探针）。 */
  probeCommandsFn?: (opts: { cwd: string; addDirs?: string[] }) => Promise<Array<{ name: string; description: string; argumentHint: string; aliases?: string[] }>>
}

/** 排队的续投消息：prompt 已拼好 preamble；dirs=该消息引用的项目外授权目录（决定能否在同进程 pushUser）；images=内联图片块（仅 claude）；
 *  checkpointId=该条 user 消息的文件检查点 uuid（仅 claude；与 transcript user_prompt 记录同源，支撑逐条 rewind）。 */
interface QueuedMsg { prompt: string; dirs: string[]; images?: ImageInlineBlock[]; checkpointId?: string }

/** claude 持久 query 的运行态：交互/控制句柄 + 档位 + 保活/空闲计时（这些字段在 codex 上不存在 = 不可表达）。 */
export interface ClaudeRunState {
  kind: 'claude'
  /** claude SDK 句柄（含 resolveDecision/setPermissionMode/rewindFiles 等交互+控制能力）。 */
  handle?: ClaudeSdkHandle
  /** 持久 query 是否存活（两轮间保活——让 rewindFiles/续投/热切换在回合后仍可用）。 */
  queryAlive: boolean
  /** 当前权限档位：起 query 传入；运行中变更走 setPermissionMode 热切。默认 default。 */
  permissionMode: string
  /** 活进程**启动时**是否带了 bypass 开关（--allow-dangerously-skip-permissions，启动期一次性给）。
   *  起后切到/切离 bypass 只能改模式标签、补不回这个开关，故 (想要 bypass) ≠ launchedBypass 时必须回合边界重起（claudeNeedsRespawn）。 */
  launchedBypass?: boolean
  /** 当前思考强度（effort）：起 query 传入；运行中变更走 applyFlagSettings 热切。 */
  effort?: string
  /** 结构化输出：起 query 时透传 query.outputFormat。 */
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }
  /** 空闲关闭计时器：query 存活但无新一轮，超时则 endInput 优雅关闭，避免空闲进程长留。 */
  idleTimer?: ReturnType<typeof setTimeout>
}
/** codex app-server 常驻的运行态：常驻 client 句柄 + 档位 + 保活/空闲计时（与 claude 持久 query 对称——一个进程跑多 turn）。 */
export interface CodexRunState {
  kind: 'codex'
  /** codex app-server 句柄（done 在 client 退出时 resolve；pushUser 同 thread 续投；interrupt 发 turn/interrupt；resolveDecision 回执）。 */
  handle?: CodexAppServerHandle
  /** 常驻 app-server 是否存活（两轮间保活——让续投/中断在回合后仍走同一进程，对齐 claude.queryAlive）。 */
  serverAlive: boolean
  /** 当前沙箱档：起 thread/start 传入；codex 不走热切 setter，仅记下，下个新 turn/start 起时随 per-turn 参数生效。省略=引擎默认（workspace-write）。 */
  sandbox?: string
  /** 当前审批档（untrusted/on-request/never）：起 thread/start 传入；同 sandbox——记下，下个新 turn 生效。 */
  approval?: string
  /** 当前思考强度（effort）：codex 是 per-turn 参数（turn/start.effort）——记下，下个 pushUser/turn 起时生效。 */
  effort?: string
  /** 空闲关闭计时器：server 存活但无新一轮，超时则 endInput 优雅关闭，避免空闲进程长留（对齐 claude.idleTimer）。 */
  idleTimer?: ReturnType<typeof setTimeout>
}
/** 判别式联合：claude 专属态（permissionMode/effort/queryAlive/idleTimer/...）在 codex 上不可表达
 *  —— make illegal states unrepresentable（spec §4.1）。访问 claude 专属字段前必须 `run.kind==='claude'` 守卫。 */
export type RunState = ClaudeRunState | CodexRunState

interface SessionState {
  engine: Engine
  model: string
  cwd: string
  running: boolean
  /** 会话已被销毁（删除）：置 true 后所有 onEvent/onTurnEnd/onDone 回调一律 no-op，绝不再回写 DB（防 interrupt 异步收尾写孤儿）。 */
  disposed: boolean
  queue: QueuedMsg[]
  /** 引擎运行态判别式联合：claude 专属字段（句柄/档位/保活）收口于此，codex 上不可表达。 */
  run: RunState
  turn: number                              // 已完成 turn 数
  resumableId: string | null
  /** 当前/最近一次 spawn 进程被授权读取的项目外目录（累积；决定排队消息能否同进程续投）。 */
  grantedDirs: string[]
  subscribers: Set<(ev: AgentEvent) => void>
  blocks: unknown[]                         // 本 turn 累积的 assistant 内容块
  /** 本 turn 的失败真因（turn_end.detail：引擎 stderr / result 报错）。onEvent 暂存、onTurnEnd 落进 run_note 块后清。
   *  turn_end 事件先于 onTurnEnd 触发（runtime 固定顺序），故这里能稳拿到，不依赖改 onTurnEnd 回调签名。 */
  failDetail?: string
  /** 本 turn 内被 task_started 标记 skip_transcript 的 Task tool_use id（→ 落库时回填到 Task 块，使重载后 §9.5 仍成立）。
   *  用 set 而非依赖事件顺序：task_started 与 Task tool_use 谁先到都能正确标记（不臆断 SDK 时序）。 */
  skipToolUses: Set<string>
  usage?: { inputTokens: number; outputTokens: number; costUsd?: number }
}

/** 斜杠命令缓存项（与 SDK SlashCommand 同形）：会话桶 / cwd 缓存 / commands_changed 推送共用此形。 */
type SlashCmd = { name: string; description: string; argumentHint: string; aliases?: string[] }

/** failed→failed；aborted/interrupted→aborted（codex turn/interrupt 吐 'interrupted'，语义=用户中止）；其余（end_turn/completed/max_tokens…）→ completed。 */
function mapStatus(stopReason: string): SessionStatus {
  if (stopReason === 'failed') return 'failed'
  if (stopReason === 'aborted' || stopReason === 'interrupted') return 'aborted'
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
      // 判别式联合的构造工厂——engine→run.kind 的唯一桥（此后一律 switch(run.kind)，不再认引擎字面名）
      // codex 重水合：从持久化会话行 seed run.sandbox/.approval（DB 列 codex_sandbox/codex_approval → SessionRow.sandbox/.approval），
      // 让重开会话后不带 runtime 的 submit 仍沿用上次两轴档（Part A P3）；null → 留 undefined 走引擎默认。
      run: sess.engine === 'claude' ? { kind: 'claude', queryAlive: false, permissionMode: 'default' } : { kind: 'codex', serverAlive: false, sandbox: sess.sandbox ?? undefined, approval: sess.approval ?? undefined },   // agent-literal-ok
      grantedDirs: [], subscribers: new Set(), blocks: [], skipToolUses: new Set(),
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
      // 无活动轮但持久句柄仍空闲存活 → 关掉它（用户主动停止会话）。两引擎对称：claude.queryAlive / codex.serverAlive。
      if (st.run.kind === 'claude' && st.run.queryAlive) { st.run.handle?.endInput(); st.run.queryAlive = false }
      else if (st.run.kind === 'codex' && st.run.serverAlive) { st.run.handle?.endInput(); st.run.serverAlive = false }
      return
    }
    st.queue.length = 0          // 中断 = 放弃排队的续投
    st.run.handle?.interrupt()    // 合成 turn_end(aborted)
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
      if (wasRunning) st.run.handle?.interrupt()
      else if (st.run.kind === 'claude' && st.run.queryAlive) st.run.handle?.endInput()
      else if (st.run.kind === 'codex' && st.run.serverAlive) st.run.handle?.endInput()
    } catch { /* 停止底层 query 失败不阻塞删除 */ }
  }

  submit(sessionId: string, text: string, contextFiles: string[] = [], runtime?: RuntimeConfig, activeFile?: string | null): void {
    const st = this.load(sessionId)
    // 应用本次提交携带的运行时档位：未运行→存起来下轮 query 生效；运行中→对 claude 活会话热切换
    this.applyRuntimeConfig(st, runtime)
    // 分类附件路径：项目内→相对、项目外→绝对+授权目录；不存在的丢弃
    const { listed, externalDirs } = resolveAttachments(st.cwd, contextFiles)
    // 文件检查点 uuid：仅 claude 一条 user 消息一个（= rewindFiles 的 userMessageId，逐条回退）。宿主在此铸，
    // 既写进 transcript user_prompt 记录、又透传给 claude turn（SDKUserMessage.uuid）→ 单一来源、两处同值。
    // codex 无文件检查点能力 → 不铸（记录不带 checkpointId）。
    const checkpointId = st.run.kind === 'claude' ? randomUUID() : undefined
    // user 提问写进 transcript（取代 messages 表写入）：原文 + 全部附件（含图片，供 ChatLog 缩略图回显——内联不改历史记录）
    // + checkpointId（仅 claude；renderer 重建 user 消息时提取挂 MessageDTO.checkpointId）
    appendRecord(this.deps.transcriptDir ?? sessionsDir(), sessionId, st.engine, 'user_prompt', { text, attachments: listed, ...(checkpointId ? { checkpointId } : {}) })
    // 仅 claude：图片读盘转 base64 内联为 image 块；非图片（含超限/读失败降级的图片）+ 非 claude 引擎 → 全走 preamble。
    // 走判别式 run.kind（不认引擎字面名）——image-inline 分流已吸收进 claude 运行态分支（spec §13 待吸收点已收口）。
    let images: ImageInlineBlock[] | undefined
    let promptListed = listed
    if (st.run.kind === 'claude') {
      const split = inlineImages(st.cwd, listed)
      images = split.imageBlocks.length ? split.imageBlocks : undefined
      promptListed = split.nonImageListed
    }
    // 引擎 prompt 才带 preamble（只拼非内联的附件）；排队也存拼好的 prompt + 其授权目录 + 内联图片块 + 检查点 uuid
    const promptText = appendCurrentFile(buildPromptWithAttachments(text, promptListed), activeFile)
    if (st.running) { st.queue.push({ prompt: promptText, dirs: externalDirs, images, checkpointId }); return }
    // claude 持久 query 空闲存活 → 复用同 query 续投（无需重 spawn / resume），前提：本消息引用的外部目录都已授权
    if (st.run.kind === 'claude' && st.run.queryAlive && st.run.handle) {
      const handle = st.run.handle   // guard 收窄处即捕获非空句柄（越过下方 clearIdleTimer(st) 的收窄失效）
      const run = st.run
      this.clearIdleTimer(st)
      if (externalDirs.every((d) => st.grantedDirs.includes(d)) && !this.claudeNeedsRespawn(run)) {
        st.running = true; st.blocks = []; st.usage = undefined
        this.onEvent(st, { type: 'turn_start' })   // 空闲续投同一 query：新轮起即发 turn_start
        st.grantedDirs = [...new Set([...st.grantedDirs, ...externalDirs])]
        handle.pushUser(promptText, images, checkpointId)   // 同源检查点 uuid 透传（与 transcript 记录同值）
        return
      }
      // 引用了新外部目录、或需为 bypass 换启动开关（claudeNeedsRespawn）→ 关掉空闲 query，排队，onDone 起新 query（带新 --add-dir / bypass 开关，沿用 resumable_id 接着聊）
      handle.endInput(); run.queryAlive = false; st.running = true
      st.queue.push({ prompt: promptText, dirs: externalDirs, images, checkpointId })
      return
    }
    // codex 常驻 app-server 空闲存活 → 复用同 thread 续投（pushUser 新起一个 turn，无需重 spawn / resume），前提：本消息引用的外部目录都已授权。
    // 与 claude 对称，但 codex 无图片/检查点（pushUser 只收 text）；新外部目录沿用同样的「关掉空闲 server、排队、onDone 起新 server 带 addDirs」路径。
    if (st.run.kind === 'codex' && st.run.serverAlive && st.run.handle) {
      const handle = st.run.handle
      const run = st.run
      this.clearIdleTimer(st)
      if (externalDirs.every((d) => st.grantedDirs.includes(d))) {
        st.running = true; st.blocks = []; st.usage = undefined
        this.onEvent(st, { type: 'turn_start' })   // 空闲续投同一 server：新轮起即发 turn_start
        st.grantedDirs = [...new Set([...st.grantedDirs, ...externalDirs])]
        handle.pushUser(promptText)
        return
      }
      // 引用了新外部目录 → 关掉空闲 server，排队，onDone 起带新 addDirs 的新 server（沿用 thread_id）
      handle.endInput(); run.serverAlive = false; st.running = true
      st.queue.push({ prompt: promptText, dirs: externalDirs, images, checkpointId })
      return
    }
    this.startTurn(sessionId, st, promptText, externalDirs, images, checkpointId)
  }

  private clearIdleTimer(st: SessionState): void {
    // 两引擎都有 idleTimer（claude 持久 query / codex 常驻 app-server）；按 run.kind 收窄后清各自的。
    const run = st.run
    if (run.idleTimer) { clearTimeout(run.idleTimer); run.idleTimer = undefined }
  }
  /** 持久句柄存活但空闲 → 起关闭计时，超时 endInput 优雅退出（→ onDone 收尾），避免空闲进程长留。claude 持久 query / codex 常驻 app-server 同此契约。 */
  private startIdleTimer(st: SessionState): void {
    this.clearIdleTimer(st)
    const run = st.run
    const handle = run.handle
    run.idleTimer = setTimeout(() => { handle?.endInput() }, this.deps.claudeSessionIdleMs ?? 600_000)
  }

  /** 更新会话运行时档位。运行中且为 claude → 对活 query 热切换（setPermissionMode / applyFlagSettings effort）。 */
  setRuntimeConfig(sessionId: string, runtime: RuntimeConfig): void {
    this.applyRuntimeConfig(this.load(sessionId), runtime)
  }

  private applyRuntimeConfig(st: SessionState, runtime?: RuntimeConfig): void {
    if (!runtime) return
    // model 是会话级（两引擎都用，下轮 spawn/query 生效）；claude 活 query 额外热切（setModel）
    if (runtime.model !== undefined && runtime.model !== st.model) {
      st.model = runtime.model
      if (st.run.kind === 'claude' && st.run.queryAlive) void st.run.handle?.setModel(runtime.model)
    }
    // codex 档位（sandbox/approval/effort）：codex app-server 不走热切 setter（不像 claude 的 setPermissionMode/setEffort），
    // 全部「记下、下个 pushUser/turn/start 起随 per-turn 参数生效」。sandbox/approval 是 thread/start 级、effort 是 turn/start 级。
    if (st.run.kind === 'codex') {
      if (runtime.sandbox !== undefined) st.run.sandbox = runtime.sandbox
      if (runtime.approval !== undefined) st.run.approval = runtime.approval
      if (runtime.effort !== undefined) st.run.effort = runtime.effort
    }
    // permissionMode/effort/outputFormat 是 claude 专属档位（codex 无对应字段，不可表达）；持久 query 两轮间也能热切（queryAlive 判定）
    if (st.run.kind === 'claude') {
      const run = st.run
      if (runtime.permissionMode !== undefined && runtime.permissionMode !== run.permissionMode) {
        run.permissionMode = runtime.permissionMode
        // 切到 bypass 但活进程不是 bypass 起的 → 绝不热切：CLI 缺启动开关，set_permission_mode 到 bypass 可能触发
        // bypass_permissions_disabled 退出、把在跑的回合搞崩。只记下意图（permissionMode 已更新），靠下一次 submit 的回合边界重起拿真绕过（claudeNeedsRespawn）。
        const enterBypassWithoutFlag = runtime.permissionMode === 'bypassPermissions' && !run.launchedBypass
        if (run.queryAlive && !enterBypassWithoutFlag) void run.handle?.setPermissionMode(runtime.permissionMode as never)
      }
      if (runtime.effort !== undefined && runtime.effort !== run.effort) {
        run.effort = runtime.effort
        if (run.queryAlive) void run.handle?.setEffort(runtime.effort)
      }
      // outputFormat 不能 mid-query 热切——只记下，下个新 query 起时生效
      if (runtime.outputFormat !== undefined) run.outputFormat = runtime.outputFormat
    }
  }

  /** claude 活进程是否需要重起换权限：bypass 的 --allow-dangerously-skip-permissions 是启动期开关，
   *  起后切到/切离 bypass 只改模式标签、补不回开关 → (想要 bypass) ≠ 启动时 bypass 时，须在回合边界沿用 resumableId 重起新进程。
   *  其余档位（default/acceptEdits/plan/dontAsk）互切走 setPermissionMode 热切即可，不重起。 */
  private claudeNeedsRespawn(run: ClaudeRunState): boolean {
    return run.queryAlive && (run.permissionMode === 'bypassPermissions') !== !!run.launchedBypass
  }

  /** 解决一个挂起的授权/提问（renderer 回执 → /sessions/:id/decision）。按引擎分发到对应活句柄；无活会话静默忽略。
   *  decision 形态在两引擎间结构兼容（ClaudeSdkDecision ≡ CodexDecision：behavior/message/updatedInput），故同一入参直接喂两边。 */
  resolveDecision(sessionId: string, requestId: string, decision: ClaudeSdkDecision): void {
    const run = this.states.get(sessionId)?.run
    if (run?.kind === 'claude') run.handle?.resolveDecision(requestId, decision)
    else if (run?.kind === 'codex') run.handle?.resolveDecision(requestId, decision)
  }

  /** 文件检查点回退（claude）。userMessageId 省略 → 回退到最近一次检查点。无活会话/非 claude/无检查点 → canRewind:false。 */
  async rewindFiles(sessionId: string, userMessageId: string | undefined, opts?: { dryRun?: boolean }) {
    const run = this.states.get(sessionId)?.run
    const h = run?.kind === 'claude' ? run.handle : undefined
    if (!h) return { canRewind: false, error: '无活动的 Claude 会话' }
    const id = userMessageId || h.lastCheckpointId()
    if (!id) return { canRewind: false, error: '无可回退的检查点' }
    return h.rewindFiles(id, opts)
  }

  /** 动态模型列表（claude）：活动 query 拉 supportedModels() 并缓存；无活会话 → 返回缓存（首个会话跑过后即有）。
   *  从未跑过任何 claude 会话 → null（前端回落静态列表）。这样模型列表「动态拉取替硬编码」在首会话后全局生效。 */
  private claudeModelsCache: Array<{ value: string; displayName: string; description: string }> | null = null
  async supportedModels(sessionId: string) {
    const run = this.states.get(sessionId)?.run
    const h = run?.kind === 'claude' ? run.handle : undefined
    if (h) {
      const m = await h.supportedModels()
      if (m && m.length) this.claudeModelsCache = m as typeof this.claudeModelsCache
    }
    return this.claudeModelsCache
  }

  /** 动态命令列表（claude，仿 supportedModels 三态，但**按 sessionId 分桶**）：活动 query 拉 supportedCommands()
   *  快照并缓存到该会话桶；query 运行中收到 commands_changed → onCommandsChanged 直接 REPLACE 该会话桶（实时）。
   *  无活句柄 → 返回该会话缓存；该会话从未跑过 → null（前端回落静态命令）。
   *  **为何按会话分桶（与 models 不同）**：命令是按会话变化的——不同工作目录发现的技能不同，故 A/B 两个 claude 会话
   *  并存时各自命令清单可能不同，单值缓存会串（A 的命令被 B 读到、commands_changed 跨会话互相覆盖）。models 列表
   *  是账号级全局的，故仍保持单值、不分桶。
   *  与 models 的另一关键差异：claudeSdk 句柄的 supportedCommands() 是 **init 一次性快照**（SDK 文档：不反映
   *  mid-session 变更），而 commands_changed 推送才是权威的实时清单。故一旦某会话已收到过 commands_changed
   *  推送，再调本方法**不可**用陈旧的 init 快照覆盖该会话更新后的缓存——用 claudeCommandsPushed 守卫保证「推送优先于重拉」（按会话）。 */
  private claudeCommandsCache = new Map<string, SlashCmd[]>()
  /** 各会话当前活动 query 是否已收到 commands_changed 推送（→ init 快照已被取代，重拉不得覆盖）。startTurn 起新 query 时按会话复位。 */
  private claudeCommandsPushed = new Set<string>()
  /** cwd 级命令缓存（对标 Claudian externalContextPaths 指纹）：无活会话时的兜底来源。key = cwd + add-dir 指纹。 */
  private cwdCommandsCache = new Map<string, SlashCmd[]>()
  /** cwd 探针并发去重（对标 Claudian providerCommandWarmups）：同 cwdKey 并发只探一次。 */
  private cwdProbePromise = new Map<string, Promise<SlashCmd[]>>()

  /**
   * 会话级命令（四态回落，spec §5.2）：
   *  ① 活查询（未被 commands_changed 取代）→ live supportedCommands() 并写会话桶（最权威）。
   *  ② 会话桶有（活查询拉过 / commands_changed 推过）→ 直接返回（活查询优先，不被旧 probe 覆盖）。
   *  ③ 无活查询 → 解析会话 cwd（内存 state.cwd 优先；重启/从未跑过回退 db 查 session→project.path）→ cwd 探针缓存兜底。
   *  ④ 探针失败 / 非 claude 会话 → []（不再 null；前端无静态可回落）。
   */
  async supportedCommands(sessionId: string): Promise<SlashCmd[]> {
    // 解析会话运行态：内存优先；无 state（daemon 重启 / 从未跑过）→ load 经构造工厂从 db 水合（engine→run.kind 唯一桥）。
    // 此后只认 run.kind（不认引擎字面名，遵守隔离铁律 §14.5）：非 claude / 会话不存在 → 无 claude 命令。
    const st = this.states.get(sessionId) ?? this.tryLoad(sessionId)
    if (!st || st.run.kind !== 'claude') return []
    const run = st.run   // run.kind === 'claude'
    // ① 活查询：live 拉取并写会话桶（除非该会话已被 commands_changed 推送取代）
    if (run.handle && !this.claudeCommandsPushed.has(sessionId)) {
      const c = await run.handle.supportedCommands()
      if (c && c.length) this.claudeCommandsCache.set(sessionId, c as SlashCmd[])
    }
    // ② 会话桶（live / commands_changed）最权威
    const sessionCached = this.claudeCommandsCache.get(sessionId)
    if (sessionCached && sessionCached.length) return sessionCached
    // ③ 无活查询 → cwd 探针兜底（cwd 来自水合后的 state.cwd = project.path）
    return this.commandsForCwd(st.cwd, st.grantedDirs)
  }

  /** 项目级命令（无会话入口，spec §5.2）：取 project.path 当 cwd → 走同一 cwd 探针缓存。项目不存在 → []。 */
  async projectCommands(projectId: string): Promise<SlashCmd[]> {
    const proj = getProject(this.deps.db, projectId)
    if (!proj) return []
    return this.commandsForCwd(proj.path, [])
  }

  /** load 的非抛版：会话/项目不存在时返回 undefined（供只读取数路径，不让 404 冒泡成异常）。 */
  private tryLoad(sessionId: string): SessionState | undefined {
    try { return this.load(sessionId) } catch { return undefined }
  }

  /** cwd 级命令：缓存命中即返回；miss → 触发探针（同 cwdKey 并发去重），仅非空结果入缓存（失败/空允许下次重探）。 */
  private async commandsForCwd(cwd: string, addDirs: string[]): Promise<SlashCmd[]> {
    const sorted = [...addDirs].sort()
    const key = cwd + ' ' + JSON.stringify(sorted)   // cwdKey = cwd + add-dir 指纹
    const cached = this.cwdCommandsCache.get(key)
    if (cached) return cached
    let p = this.cwdProbePromise.get(key)
    if (!p) {
      const probe = this.deps.probeCommandsFn ?? ((o) => probeClaudeCommands(o))
      p = probe({ cwd, addDirs: sorted })
        .then((cmds) => { if (cmds && cmds.length) this.cwdCommandsCache.set(key, cmds as SlashCmd[]); return (cmds ?? []) as SlashCmd[] })
        .catch(() => [] as SlashCmd[])
        .finally(() => { this.cwdProbePromise.delete(key) })
      this.cwdProbePromise.set(key, p)
    }
    return p
  }

  private startTurn(sessionId: string, st: SessionState, prompt: string, addDirs: string[] = [], images?: ImageInlineBlock[], checkpointId?: string): void {
    st.running = true
    st.blocks = []
    st.usage = undefined
    this.onEvent(st, { type: 'turn_start' })   // running 状态机入口（spec §4.4）：新轮起即发，外壳据此进 running
    // 累积授权目录：新进程拿到本会话至今所有外部目录，减少后续重 spawn
    st.grantedDirs = [...new Set([...st.grantedDirs, ...addDirs])]
    const onEvent = (ev: AgentEvent) => this.onEvent(st, ev)
    const onTurnEnd = (stopReason: string) => this.onTurnEnd(sessionId, st, stopReason)
    const onResumableId = (id: string) => { st.resumableId = id; setResumableId(this.deps.db, sessionId, id) }
    const onInit = (info: { sessionId: string; claudeCodeVersion?: string }) =>
      setSessionVersions(this.deps.db, sessionId, { claudeCodeVersion: info.claudeCodeVersion, sdkVersion: SDK_VERSION })
    const onRawMessage = (msg: unknown) =>
      appendRecord(this.deps.transcriptDir ?? sessionsDir(), sessionId, st.engine, (msg as any)?.type ?? 'unknown', msg)

    const creds = this.deps.resolveCreds?.(st.engine)
    const proxy = this.deps.resolveProxy?.(st.engine)
    const skillEnv = this.deps.resolveSkillEnv?.(st.cwd)
    this.deps.materializeSkillFiles?.(st.cwd)   // file 槽位物化（env 已由 resolveSkillEnv 处理）

    if (st.run.kind === 'claude') {
      const run = st.run
      // 新 query 起：按会话复位「commands 已推送」标记——新进程的 init 快照重新成为本会话基线，直到本 query 再次收到 commands_changed
      this.claudeCommandsPushed.delete(sessionId)
      // Claude 走 SDK 常驻 query：权限档/思考强度真生效（接 §3 真链路）；addDirs→additionalDirectories；
      // 队列/续投/中断/收尾沿用同一 onTurnEnd/onDone（SDK handle 与 CLI handle 同形）。
      // 起 SDK turn 的实际动作（cliAppend = 已装 CLI 工具系统提示块，无 cli 注入时为 null）
      const launch = (cliAppend: string | null) => {
        const handle = runClaudeSdkTurn({
          cwd: st.cwd,
          model: st.model,
          prompt,
          ...(images && images.length ? { images } : {}),   // 首轮内联图片块（仅 claude）
          ...(checkpointId ? { checkpointId } : {}),          // 首轮文件检查点 uuid（与 transcript user_prompt 记录同源）
          permissionMode: run.permissionMode as never,
          effort: run.effort,
          addDirs: st.grantedDirs,
          resumableId: st.resumableId ?? undefined,
          enableFileCheckpointing: true,   // 开检查点 → 支持 rewindFiles 文件回退
          ...(run.outputFormat ? { outputFormat: run.outputFormat } : {}),   // 结构化输出透传
          idleTimeoutMs: this.deps.claudeIdleTimeoutMs ?? 300_000,   // idle 看门狗：5 分钟无响应判卡死
          queryFn: this.deps.claudeQueryFn,
          creds,
          proxy,
          skillEnv,
          installSkill: this.deps.installSkill,
          createSkill: this.deps.createSkill,
          createAutomation: this.deps.createAutomation,
          ...(cliAppend ? { appendSystemPrompt: cliAppend } : {}),   // 已装 CLI 工具上下文（spec §A.8）
          ...(this.deps.cli ? { cli: this.deps.cli } : {}),          // cli-tools service 句柄 → 挂 as_cli_* MCP
          onEvent, onTurnEnd, onResumableId, onRawMessage, onInit,
          // commands_changed 实时推送：REPLACE 本会话命令缓存（不合并），并标记本会话推送已取代 init 快照（重拉不得回退）
          onCommandsChanged: (commands) => {
            if (commands && commands.length) {
              this.claudeCommandsCache.set(sessionId, commands as SlashCmd[])
              this.claudeCommandsPushed.add(sessionId)
              // P1：把新清单扇出给订阅者 → 经会话 SSE 推前端，让「正开着的命令列表」当场刷新（不必关掉重开）
              this.onEvent(st, { type: 'commands_changed', commands: commands as SlashCmd[] })
            }
          },
        })
        run.handle = handle
        run.queryAlive = true   // 持久 query：起后保活，直到 endInput/interrupt/idle 关闭
        run.launchedBypass = run.permissionMode === 'bypassPermissions'   // 记下本进程启动时的 bypass 开关态（决定后续能否热切到 bypass，见 claudeNeedsRespawn）
        void handle.done.then(() => this.onDone(sessionId, st))
      }
      // 有 cli 句柄：先算已装工具上下文（async；detectAllCliTools 有 120s 缓存摊销）再起 turn；
      // 无 cli：同步起（保持原行为、零回归——现有测试不注入 cli）。检测失败不阻断 turn，仅不注入上下文。
      if (this.deps.cli) {
        void this.deps.cli.installed()
          .then((r) => launch(buildCliToolsContext(r)))
          .catch(() => launch(null))
      } else {
        launch(null)
      }
      return
    }

    // Codex 走 app-server 常驻（Part A P3.4）：包常驻进程、与 claude 持久 query 同形（done 在 client 退出时 resolve、
    // pushUser 同 thread 续投、interrupt 发 turn/interrupt、resolveDecision 回执）。档位（sandbox/approval/effort）按 per-turn
    // 参数随 thread/start·turn/start 透传——codex 不走热切 setter，下个 turn 起生效。onResumableId 把 thread_id 当 resume 指针落库。
    const run = st.run   // st.run.kind === 'codex'（已被上方 claude 分支 return 收窄）
    const handle = runCodexAppServerTurn({
      cwd: st.cwd,
      model: st.model,
      prompt,
      binPath: this.deps.resolveBin(st.engine),
      pathDir: this.deps.resolveCodexPathDir?.(),
      sandbox: run.sandbox,
      approval: run.approval,
      effort: run.effort,
      addDirs: st.grantedDirs,
      resumableId: st.resumableId ?? undefined,
      creds,
      skillEnv,
      idleTimeoutMs: this.deps.claudeIdleTimeoutMs ?? 300_000,   // idle 看门狗：复用 claude 的 turn 内卡死判定阈值（5 分钟无通知）
      automationMcpEntry: this.deps.automationMcpEntry,
      clientFactory: this.deps.codexClientFactory,
      spawnFn: this.deps.spawnFn,
      onEvent, onTurnEnd, onResumableId,
    })
    run.handle = handle
    run.serverAlive = true   // 常驻 app-server：起后保活，直到 endInput/interrupt/idle 关闭（对齐 claude.queryAlive）
    void handle.done.then(() => this.onDone(sessionId, st))
  }

  private onEvent(st: SessionState, raw: AgentEvent): void {
    if (st.disposed) return   // 会话已删除：丢弃迟到事件，不推送、不累积
    const ev = truncateEvent(raw, this.deps.truncateLimit ?? TRUNCATE_LIMIT)
    for (const fn of st.subscribers) fn(ev)
    switch (ev.type) {
      // 落库 block 用 type:'text'（与 user 文本块、M5 messages 约定、MVP spec 一致；内部事件类型是 message，但块语义=纯文本）
      // parentToolUseId 必须随块落库（子代理归属键）：否则重载历史后 buildChildrenMap 拿不到归属 → 形态 A 嵌套与形态 B 卡片塌掉。
      // 与实时 SSE 通路（truncateEvent {...ev} 整体保留）对齐，保证「历史===实时」也覆盖子代理归属。
      case 'message': st.blocks.push({ type: 'text', text: ev.text, ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}) }); break
      case 'thinking': st.blocks.push({ type: 'thinking', text: ev.text, ...(ev.elapsedMs !== undefined ? { elapsedMs: ev.elapsedMs } : {}), ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}) }); break
      // Task 块若已被 task_started 标记 skip_transcript（set 命中），落库时回填——使重载后形态 A 仍据此从时间线排除（§9.5）
      case 'tool_use': st.blocks.push({ type: 'tool_use', id: ev.id, name: ev.name, input: ev.input, ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}), ...(ev.tool ? { tool: ev.tool } : {}), ...(st.skipToolUses.has(ev.id) ? { skipTranscript: true } : {}) }); break
      case 'tool_result': st.blocks.push({ type: 'tool_result', toolUseId: ev.toolUseId, ok: ev.ok, content: ev.content, ...(ev.parentToolUseId ? { parentToolUseId: ev.parentToolUseId } : {}) }); break
      case 'subagent': {
        // §9.5：task_started.skip_transcript 标记其 Task 块（tool_use_id），落库前回填到该块；Task 块或先或后到都覆盖：
        // ① 已在 st.blocks 中 → 直接回填；② 尚未到 → 记入 skipToolUses，待 tool_use 落库时带上。子代理事件本身不入块。
        if (ev.phase === 'started' && ev.skipTranscript && ev.toolUseId) {
          st.skipToolUses.add(ev.toolUseId)
          const blk = st.blocks.find((b) => (b as { id?: string; name?: string }).id === ev.toolUseId && (b as { name?: string }).name === 'Task') as { skipTranscript?: boolean } | undefined
          if (blk) blk.skipTranscript = true
        }
        break
      }
      // codex 子代理生命周期事件（spawned/item/status/report/wait/closed）作块随 assistant_blocks 落库（P5c）：
      // 切片私有事件，daemon 不解释——整事件原样存为块（带 threadId 归属），重载时 renderer codex 切片
      // 经 historyService.rebuildSliceState replay 同一 codexSubagentReduce 还原 sliceState（live===重载）。
      // claude 永不发此事件 → 对 claude 落库零影响。
      // 流式 message 增量帧（item.kind:'message', streaming:true）**不落库**（根治 transcript 膨胀）：一条子消息流式 N 段
      // 会发 N 个递增前缀帧，全存=N 个块（重载靠 reduce 替换语义折成 1，正确但臃肿）。codexAppServer 对每条子消息
      // 必在 item/completed 发一帧定格 message（streaming 缺省，item.text 全文，见 codexAppServer §子线程 item 路由 +
      // mapItemToSubItem）——它即权威全文帧。故只落定格帧（+ 所有非 message 帧），丢中间流式帧：replay 后 items 序列
      // 与「全帧落库经 reduce 折叠」逐字相同（定格帧 text=最长=流式末帧会折成的那条）→ live===重载不变（round-trip 守恒）。
      case 'codex_subagent': {
        const isStreamingMsg = ev.phase === 'item' && ev.item?.kind === 'message' && ev.item.streaming === true
        if (!isStreamingMsg) st.blocks.push({ ...ev })   // ev 已含 type:'codex_subagent' → 整事件即块
        break
      }
      case 'usage': st.usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: ev.costUsd }; break
      case 'turn_end': st.failDetail = ev.detail; break   // 暂存真因，落库在 onTurnEnd 统一做（含 run_note 块）
    }
  }

  private onTurnEnd(sessionId: string, st: SessionState, stopReasonRaw: string): void {
    if (st.disposed) return   // 会话已删除：interrupt 异步收尾到此为止，绝不回写 messages/usage/status
    // codex turn/interrupt 吐 'interrupted'（= 用户中止），归一为 'aborted'，使下方 run_note / 队列清空 / 保活分支与 claude 一视同仁。
    // claude 永不吐 'interrupted'（其中止合成 'aborted'），故此归一对 claude 无副作用。
    const stopReason = stopReasonRaw === 'interrupted' ? 'aborted' : stopReasonRaw
    const db = this.deps.db
    const turnNo = st.turn + 1
    if (st.usage) {
      recordUsage(db, { sessionId, turn: turnNo, ...st.usage })
    }
    setSessionStatus(db, sessionId, mapStatus(stopReason))
    st.turn = turnNo
    // 失败/中止 → 往本轮 blocks 末尾补一个 run_note 块，使「这一轮失败了/被中止了 + 真因」作为历史的一部分落库。
    // 重载时随 messages 内联留痕、不被后续轮覆盖（对齐 Claudian 错误即历史）；纯失败轮（blocks 空）也据此落一条记录。
    if (stopReason === 'failed' || stopReason === 'aborted') {
      st.blocks.push({ type: 'run_note', stopReason, ...(st.failDetail ? { detail: st.failDetail } : {}) })
    }
    st.failDetail = undefined
    // 把组装好的 assistant blocks 写一条 transcript 记录作渲染源（含真思考；保证历史===实时）。
    // claude 同时有 onRawMessage 原始流（调试/取 msg_id 用），但渲染统一以此为准。
    if (st.blocks.length > 0) {
      // 落库前折叠流式前缀堆叠的文本块（根治：onEvent 对每个 message 增量都 push 了一个块）→ 重载===实时
      appendRecord(this.deps.transcriptDir ?? sessionsDir(), sessionId, st.engine, 'assistant_blocks', { blocks: collapseStreamingText(st.blocks) })
    }
    st.blocks = []
    st.skipToolUses.clear()   // skip 标记随块落库后清空（与本 turn 块同生命周期）
    st.usage = undefined
    // 持久句柄（turnBoundary='event'：claude SDK query / codex app-server）：本轮结束后**保活**（不 endInput）→ 让续投/中断/
    // （claude 的 rewindFiles）在回合后仍可用。codex 走同一保活契约（serverAlive 与 queryAlive 对称）。
    if (getRuntimeDef(st.engine).turnBoundary === 'event') {
      if (stopReason === 'aborted') {
        st.queue.length = 0                       // 中断：持久句柄正被 interrupt 关，交 onDone 收尾
      } else if (stopReason === 'failed') {
        st.queue.length = 0; st.running = false   // 失败：放弃续投；句柄保活，下次 submit 复用
        // 句柄仍存活 → 起空闲关闭计时（两引擎同此契约：claude.queryAlive / codex.serverAlive）
        if ((st.run.kind === 'claude' && st.run.queryAlive) || (st.run.kind === 'codex' && st.run.serverAlive)) this.startIdleTimer(st)
      } else {
        const next = st.queue[0]                  // 先 peek 不 shift
        if (!next) {
          st.running = false                      // 队列空 → 不 endInput！持久句柄保活，running 归 false，起空闲关闭计时
          this.startIdleTimer(st)
        } else if (next.dirs.every((d) => st.grantedDirs.includes(d)) && !(st.run.kind === 'claude' && this.claudeNeedsRespawn(st.run))) {
          st.queue.shift()
          this.onEvent(st, { type: 'turn_start' })   // 排空续投同一句柄：新轮起即发 turn_start
          if (st.run.kind === 'claude') st.run.handle?.pushUser(next.prompt, next.images, next.checkpointId)   // claude：授权够 → 同 query 续投（带图 + 检查点 uuid）
          else if (st.run.kind === 'codex') st.run.handle?.pushUser(next.prompt)                               // codex：授权够 → 同 thread 续投（无图/无检查点）
        } else {
          st.run.handle?.endInput()               // 引用了新外部目录、或 claude 需为 bypass 换启动开关 → 排空，留队列交 onDone 起新句柄（换 addDirs / bypass 开关，沿用 resumableId）
        }
      }
    }
  }

  private onDone(sessionId: string, st: SessionState): void {
    if (st.disposed) return   // 会话已删除：句柄收尾由 dispose 负责，这里不再续投/改状态
    // query 真正退出（endInput→完成 / 中断 / 崩溃）→ 清句柄与存活态、计时器
    this.clearIdleTimer(st)
    st.run.handle = undefined
    if (st.run.kind === 'claude') st.run.queryAlive = false
    if (st.run.kind === 'codex') st.run.serverAlive = false
    const next = st.queue.shift()
    if (next !== undefined) {
      // 队列有残留 → 起新进程 resume 投递：codex 正常续投；claude 是排空窗口/新外部目录场景。两引擎都用 st.resumableId，不丢消息。
      this.startTurn(sessionId, st, next.prompt, next.dirs, next.images, next.checkpointId)
    } else {
      st.running = false
    }
  }
}
