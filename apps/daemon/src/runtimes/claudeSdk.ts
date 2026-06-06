import type { AgentEvent } from '@agent-shell/contracts'
import type {
  Options,
  PermissionMode,
  PermissionResult,
  ModelInfo,
  RewindFilesResult,
  SDKUserMessage,
  SlashCommand,
  Query,
} from '@anthropic-ai/claude-agent-sdk'
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { createClaudeObjectParser } from './stream/claude'
import { sanitizeEnv } from './env'
import { channelDataDir } from '../paths'
import type { AuthStrategy } from './types'
import type { ImageInlineBlock } from '../session/imageInline'

// Issue 1 诊断：SDK 把 spawn 真错误（errno/stderr）替换成「exists but failed to launch」泛化消息后再抛。
// 这里把完整 error（所有自有属性 + cause 链 + stack）连同 cwd/PATH 上下文落盘，先拿到真因再决定修法，不臆测。
function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    const obj: Record<string, unknown> = { name: err.name, message: err.message, stack: err.stack }
    const rec = err as unknown as Record<string, unknown>
    for (const k of Object.getOwnPropertyNames(err)) { if (!(k in obj)) obj[k] = rec[k] }
    const cause = (err as { cause?: unknown }).cause
    if (cause !== undefined) obj.cause = serializeError(cause)
    return obj
  }
  return String(err)
}

function logClaudeError(context: Record<string, unknown>, err: unknown): void {
  const entry = { at: new Date().toISOString(), context, error: serializeError(err) }
  try {
    const dir = path.join(channelDataDir(), 'logs')
    fs.mkdirSync(dir, { recursive: true })
    fs.appendFileSync(path.join(dir, 'claude-errors.log'), JSON.stringify(entry, null, 2) + '\n\n')
  } catch { /* 落盘失败不致命，仍走 console */ }
  console.error('[claudeSdk] query 失败:', JSON.stringify(entry))
}

/** claude 凭证 env（与 CLI claudeDef 一致）；SDK 与 CLI spawn 同一 claude 二进制、读同样的 env。
 *  导出供命令探针（claudeCommandProbe）复用同一套 env 净化口径，避免两条解析路径漂移。 */
export const CLAUDE_AUTH: AuthStrategy = { apiKeyEnv: 'ANTHROPIC_API_KEY', baseUrlEnv: 'ANTHROPIC_BASE_URL', altKeyEnv: 'ANTHROPIC_AUTH_TOKEN' }

/** query() 的形态：streaming-input 模式 prompt 为 AsyncIterable<SDKUserMessage>。可注入（测试）。 */
export type ClaudeQueryFn = (args: { prompt: AsyncIterable<SDKUserMessage>; options?: Options }) => Query

/** 用户对一次授权/提问的裁决（renderer 经 /sessions/:id/decision 回执）。 */
export interface ClaudeSdkDecision {
  behavior: 'allow' | 'deny'
  /** deny 时给模型的理由；allow 可省。 */
  message?: string
  /** allow 时可改写工具入参（如修正路径）。AskUserQuestion 的回答也走这里回填工具入参。 */
  updatedInput?: Record<string, unknown>
}

export interface ClaudeSdkTurnOpts {
  cwd: string
  model: string
  prompt: string
  /** 首轮内联图片块（base64 image）；无则纯文本。 */
  images?: ImageInlineBlock[]
  /** 5 档之一，默认 default（default 时 canUseTool 才触发逐工具授权）。 */
  permissionMode?: PermissionMode
  effort?: string
  /** 需授权读取的项目外目录（→ additionalDirectories）。 */
  addDirs?: string[]
  /** 引擎侧 resume 指针（session_id）。 */
  resumableId?: string
  baseEnv?: NodeJS.ProcessEnv
  /** BYOK（V1 不传）。 */
  creds?: { baseUrl?: string; apiKey?: string; keyEnv?: 'api_key' | 'auth_token' }
  enableFileCheckpointing?: boolean
  outputFormat?: { type: 'json_schema'; schema: Record<string, unknown> }
  onEvent: (ev: AgentEvent) => void
  onTurnEnd?: (stopReason: string) => void
  onResumableId?: (id: string) => void
  /** 旁路抛出每条「最终」原始消息（跳过 stream_event 分片）；用于 transcript 落盘。 */
  onRawMessage?: (msg: unknown) => void
  /** init 系统消息到达：带 SDK 会话 id 与 claude_code_version。 */
  onInit?: (info: { sessionId: string; claudeCodeVersion?: string }) => void
  /** commands_changed 系统消息到达：SDK 推送完整新命令清单（mid-session 动态发现技能等）→ 调用方 REPLACE 缓存。 */
  onCommandsChanged?: (commands: SlashCommand[]) => void
  /** 注入假 query（测试）；默认动态加载真实 SDK query。 */
  queryFn?: ClaudeQueryFn
  /** idle 看门狗：距上次 SDK 消息超此毫秒数无活动 → 中断兜底。0/省略 = 不启用。 */
  idleTimeoutMs?: number
  /** requestId 生成（测试可注入确定值）。 */
  genId?: () => string
  /** 检查点 uuid 生成（测试可注入确定值）；默认 crypto.randomUUID。 */
  genCheckpointId?: () => string
}

export interface ClaudeSdkHandle {
  /** 与 RunTurnHandle 同形（exitCode 对 SDK 恒 null）：generator 完成 / 中断后 resolve。 */
  done: Promise<{ exitCode: number | null }>
  interrupt: (graceMs?: number) => void
  /** 往同一会话续投下一条 user 消息（streaming-input 排队）；可带 base64 image 块（续投轮内联图片）。 */
  pushUser: (text: string, imageBlocks?: ImageInlineBlock[]) => void
  /** 结束输入流，让 query 跑完退出。 */
  endInput: () => void
  /** 解决一个挂起的授权/提问（renderer 回执）。未知 requestId 静默忽略（过期）。 */
  resolveDecision: (requestId: string, decision: ClaudeSdkDecision) => void
  setPermissionMode: (mode: PermissionMode) => Promise<void>
  setEffort: (effort: string) => Promise<void>
  setModel: (model: string) => Promise<void>
  supportedModels: () => Promise<ModelInfo[]>
  /** init 时一次性快照命令清单（SDK 文档：supportedCommands() 仅在 initialize 捕获、不反映 mid-session 变更）。 */
  supportedCommands: () => Promise<SlashCommand[]>
  rewindFiles: (userMessageId: string, opts?: { dryRun?: boolean }) => Promise<RewindFilesResult>
  /** 最近一次可回退检查点（SDK 赋予 user 消息的 uuid，从流里嗅探）。无则 undefined。 */
  lastCheckpointId: () => string | undefined
}

/** 可推送的 SDKUserMessage 异步可迭代：首条是初始 prompt，pushUser 续投，end 关闭。 */
class InputStream implements AsyncIterable<SDKUserMessage> {
  private queue: SDKUserMessage[] = []
  private waiting: ((r: IteratorResult<SDKUserMessage>) => void) | null = null
  private ended = false

  push(text: string, uuid?: string, imageBlocks?: ImageInlineBlock[]): void {
    // uuid 由宿主分配 → 该 uuid 即文件检查点 id（rewindFiles 据此回退到本条 user 消息前的状态）
    // 有图：content = [...image 块, {type:text}]（镜像 Claudian buildUserContentBlocks）；无图：维持现状纯文本块。
    const content = imageBlocks && imageBlocks.length
      ? [...imageBlocks, { type: 'text', text }]
      : [{ type: 'text', text }]
    const msg = { type: 'user', message: { role: 'user', content }, parent_tool_use_id: null, ...(uuid ? { uuid } : {}) } as unknown as SDKUserMessage
    if (this.waiting) { const w = this.waiting; this.waiting = null; w({ done: false, value: msg }) }
    else this.queue.push(msg)
  }

  end(): void {
    this.ended = true
    if (this.waiting) { const w = this.waiting; this.waiting = null; w({ done: true, value: undefined as unknown as SDKUserMessage }) }
  }

  [Symbol.asyncIterator](): AsyncIterator<SDKUserMessage> {
    return {
      next: (): Promise<IteratorResult<SDKUserMessage>> => {
        if (this.queue.length > 0) return Promise.resolve({ done: false, value: this.queue.shift()! })
        if (this.ended) return Promise.resolve({ done: true, value: undefined as unknown as SDKUserMessage })
        return new Promise((res) => { this.waiting = res })
      },
    }
  }
}

/** 起一轮（或续接）Claude SDK 会话：包 query() 常驻流，对外暴露与 CLI 适配器同形的 handle。 */
export function runClaudeSdkTurn(opts: ClaudeSdkTurnOpts): ClaudeSdkHandle {
  const input = new InputStream()
  // 每条 user prompt 宿主自分配 uuid → 即文件检查点 id。lastCheckpointId 记最近一条（rewindFiles 默认回退到此）。
  const genUuid = opts.genCheckpointId ?? (() => randomUUID())
  let lastCheckpointId: string | undefined
  const pushPrompt = (text: string, imageBlocks?: ImageInlineBlock[]): void => { const id = genUuid(); lastCheckpointId = id; input.push(text, id, imageBlocks) }
  pushPrompt(opts.prompt, opts.images)

  const env = sanitizeEnv(CLAUDE_AUTH, opts.baseEnv ?? process.env, opts.creds)
  const parse = createClaudeObjectParser()

  // ── 交互回路：每个挂起的 canUseTool 一个待决 Promise，requestId 索引 ──────────
  let idCounter = 0
  const genId = opts.genId ?? (() => `perm_${++idCounter}`)
  // input 保留：allow 必须回 updatedInput（SDK 运行时 Zod 要求它是 record，缺了会「Tool permission request failed」→ 工具失败）
  // isAsk：AskUserQuestion 的回答走 updatedInput 但必须**合并**进原 input（保留 questions，否则工具 .map(questions) 崩 → 死循环重问）
  interface Pending { resolve: (r: PermissionResult) => void; reject: (e: unknown) => void; input: Record<string, unknown>; isAsk: boolean }
  const pending = new Map<string, Pending>()

  const settle = (requestId: string, outcome: 'allow' | 'deny' | 'cancelled'): Pending | undefined => {
    const p = pending.get(requestId)
    if (!p) return undefined
    pending.delete(requestId)
    opts.onEvent({ type: 'permission_resolved', requestId, outcome })
    return p
  }
  const cancelAll = (): void => {
    for (const requestId of [...pending.keys()]) {
      settle(requestId, 'cancelled')?.reject(new Error('permission request cancelled'))
    }
  }

  const canUseTool = (toolName: string, input: Record<string, unknown>, copts: { signal?: AbortSignal; title?: string; displayName?: string; description?: string }): Promise<PermissionResult> => {
    const requestId = genId()
    if (toolName === 'AskUserQuestion') {
      const questions = Array.isArray((input as { questions?: unknown })?.questions) ? (input as { questions: unknown[] }).questions : []
      opts.onEvent({ type: 'ask_user_question', requestId, questions: questions as never })
    } else {
      opts.onEvent({
        type: 'permission_request', requestId, toolName, input,
        ...(copts?.title ? { title: copts.title } : {}),
        ...(copts?.displayName ? { displayName: copts.displayName } : {}),
        ...(copts?.description ? { description: copts.description } : {}),
      })
    }
    return new Promise<PermissionResult>((resolve, reject) => {
      pending.set(requestId, { resolve, reject, input, isAsk: toolName === 'AskUserQuestion' })
      // SDK 侧 abort（如查询被取消）→ 同样撤销该挂起项，防止永久挂起。
      copts?.signal?.addEventListener('abort', () => { settle(requestId, 'cancelled')?.reject(new Error('aborted')) }, { once: true })
    })
  }

  const options: Options = {
    cwd: opts.cwd,
    model: opts.model,
    env: env as Record<string, string | undefined>,
    includePartialMessages: true,
    // 子代理（Task 派生）展示需要其完整对话文本：默认 SDK 只流子代理 tool_use/tool_result（够心跳），
    // 置 true 才把子代理 assistant 文本+thinking 一并带 parent_tool_use_id 流出，供渲染内部时间线（spec D2，写死开）。
    forwardSubagentText: true,
    // 用 Claude Code 默认系统提示（含「工作目录」等动态段）：否则模型不知 cwd，会把文件写到家目录等乱猜路径。
    // 对齐 CLI `claude -p` 的默认行为。
    systemPrompt: { type: 'preset', preset: 'claude_code' },
    canUseTool,
    permissionMode: opts.permissionMode ?? 'default',
    ...(opts.effort ? { effort: opts.effort as Options['effort'] } : {}),
    ...(opts.permissionMode === 'bypassPermissions' ? { allowDangerouslySkipPermissions: true } : {}),
    ...(opts.addDirs && opts.addDirs.length ? { additionalDirectories: opts.addDirs } : {}),
    ...(opts.resumableId ? { resume: opts.resumableId } : {}),
    ...(opts.enableFileCheckpointing ? { enableFileCheckpointing: true } : {}),
    ...(opts.outputFormat ? { outputFormat: opts.outputFormat } : {}),
  }

  let resolveDone!: (v: { exitCode: number | null }) => void
  const done = new Promise<{ exitCode: number | null }>((res) => { resolveDone = res })

  // 合成终结（aborted/failed）：SDK interrupt/异常退出不一定吐 result，需补一条 turn_end 让 SessionRuntime
  // 落 status + 清队列（对齐 CLI scheduler 的 finalize 兜底）。guard 保证只补一次，不与正常 result 的 turn_end 冲突。
  let terminalEmitted = false
  let interrupted = false
  let finished = false
  const emitTerminal = (stopReason: string, detail?: string): void => {
    if (terminalEmitted) return
    terminalEmitted = true
    opts.onEvent({ type: 'turn_end', stopReason, ...(detail ? { detail } : {}) })
    opts.onTurnEnd?.(stopReason)
  }

  // query() 同步返回 Query；默认走真实 SDK（动态 import）。q 可能异步就绪 → 控制方法 await ready。
  let q: Query | null = null
  let resolveReady!: (v: Query) => void
  const ready = new Promise<Query>((res) => { resolveReady = res })

    // idle 看门狗：距上次 SDK 消息超 idleTimeoutMs 无任何动静 → 判定卡死，合成 failed 并中断（防 open-design 600s stall）。
    // 仅在「turn 进行中」生效——持久 query 在两轮间等待输入时是合法空闲，不能被它误杀（turnActive 控制）。
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  let turnActive = true
  const clearIdle = () => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined } }
  const resetIdle = () => {
    if (!opts.idleTimeoutMs || !turnActive) { clearIdle(); return }
    clearIdle()
    idleTimer = setTimeout(() => {
      interrupted = true
      cancelAll()
      emitTerminal('failed', `idle 超时：${Math.round((opts.idleTimeoutMs ?? 0) / 1000)}s 无响应`)
      void ready.then((qq) => qq.interrupt()).catch(() => {})
    }, opts.idleTimeoutMs)
  }

  const start = async (): Promise<void> => {
    if (opts.queryFn) {
      q = opts.queryFn({ prompt: input, options })
    } else {
      const sdk = await import('@anthropic-ai/claude-agent-sdk')
      q = sdk.query({ prompt: input, options })
    }
    resolveReady(q)
    resetIdle()
    let lastAssistantMsgId: string | undefined
    let lastAssistantUuid: string | undefined
    try {
      for await (const msg of q) {
        resetIdle()   // 收到消息 → 重置看门狗
        if ((msg as any)?.type !== 'stream_event') opts.onRawMessage?.(msg)
        if ((msg as any)?.type === 'assistant') {
          if (typeof (msg as any).message?.id === 'string') lastAssistantMsgId = (msg as any).message.id
          if (typeof (msg as any).uuid === 'string') lastAssistantUuid = (msg as any).uuid
        }
        for (const ev of parse(msg)) {
          if (ev.type === 'turn_end') {
            ;(ev as any).sdkMessageId = lastAssistantMsgId
            ;(ev as any).sdkUuid = lastAssistantUuid
            lastAssistantMsgId = undefined; lastAssistantUuid = undefined
            turnActive = false; clearIdle(); opts.onTurnEnd?.(ev.stopReason)
          }   // 本轮結束 → 暂停看门狗，等下一次 pushUser
          opts.onEvent(ev)
        }
        if ((msg as any)?.type === 'system' && (msg as any)?.subtype === 'init') {
          const sid = (msg as any).session_id
          if (typeof sid === 'string') {
            opts.onResumableId?.(sid)
            opts.onInit?.({ sessionId: sid, claudeCodeVersion: (msg as any).claude_code_version })
          }
        }
        // SDK fire-and-forget 推送：mid-session 命令清单变更（如子目录里发现新技能）→ 调用方 REPLACE 缓存
        if ((msg as any)?.type === 'system' && (msg as any)?.subtype === 'commands_changed') {
          const cmds = (msg as any).commands
          if (Array.isArray(cmds)) opts.onCommandsChanged?.(cmds as SlashCommand[])
        }
      }
      finished = true   // generator 完成 → query 进程退出，控制方法不可再用（否则崩 daemon）
      clearIdle()
      cancelAll()   // 流自然结束：清掉任何残留挂起项（防 UI 悬挂）
      if (interrupted) emitTerminal('aborted')   // 中断致 generator 完成而未补终结 → 补 aborted
      resolveDone({ exitCode: null })
    } catch (err) {
      finished = true
      clearIdle()
      cancelAll()   // 进程死/异常：reject 所有挂起的授权 Promise（防 open-design 600s stall）
      // Issue 1：落盘完整错误 + 上下文（cwd / PATH 是否就绪），供诊断 SDK 吞掉的 spawn 真因
      logClaudeError({ cwd: options.cwd, hasPath: !!process.env.PATH, model: options.model }, err)
      emitTerminal('failed', err instanceof Error ? err.message : String(err))
      resolveDone({ exitCode: null })
    }
  }
  void start()

  // 控制方法包一层：query 结束后（finished）调它的控制请求会打到死进程 → 崩 daemon。统一 guard + try/catch。
  const ctrl = async <T>(fn: (q: Query) => Promise<T>, fallback: T): Promise<T> => {
    if (finished) return fallback
    try { return await fn(await ready) } catch { return fallback }
  }

  return {
    done,
    interrupt: () => { interrupted = true; cancelAll(); emitTerminal('aborted'); if (!finished) void ready.then((qq) => qq.interrupt()).catch(() => {}) },
    pushUser: (text: string, imageBlocks?: ImageInlineBlock[]) => { turnActive = true; resetIdle(); pushPrompt(text, imageBlocks) },   // 新一轮开始 → 重启看门狗 + 新检查点
    endInput: () => input.end(),
    resolveDecision: (requestId, decision) => {
      if (decision.behavior === 'allow') {
        const p = settle(requestId, 'allow')
        if (p) {
          // AskUserQuestion：把答案合并进原 input（保留 questions，避免工具崩溃 + 死循环）；
          // 普通工具：用户改写过用改写值，否则回原始 input（SDK 要求 allow 必带 record）。
          const updatedInput = p.isAsk
            ? { ...p.input, ...(decision.updatedInput ?? {}) }
            : (decision.updatedInput ?? p.input)
          p.resolve({ behavior: 'allow', updatedInput })
        }
      } else {
        settle(requestId, 'deny')?.resolve({ behavior: 'deny', message: decision.message ?? 'User denied' })
      }
    },
    setPermissionMode: async (mode) => { await ctrl((qq) => qq.setPermissionMode(mode), undefined) },
    setEffort: async (effort) => { await ctrl((qq) => qq.applyFlagSettings({ effortLevel: effort as never }), undefined) },
    setModel: async (model) => { await ctrl((qq) => qq.setModel(model), undefined) },
    supportedModels: async () => ctrl((qq) => qq.supportedModels(), [] as ModelInfo[]),
    supportedCommands: async () => ctrl((qq) => qq.supportedCommands(), [] as SlashCommand[]),
    rewindFiles: async (id, o) => ctrl((qq) => qq.rewindFiles(id, o), { canRewind: false, error: '会话已结束，无法回退（请在会话进行中操作）' } as RewindFilesResult),
    lastCheckpointId: () => lastCheckpointId,
  }
}
