import type { AgentEvent, CodexSubItem } from '@agent-shell/contracts'
import { mapAppServerEvent, mapItemToSubItem } from './eventMap'

/**
 * Codex app-server【协议适配器】（Part A · Phase 3.2 · D8）。
 *
 * 职责边界：抽掉「协议版本相关的形状细节」——initialize/thread/turn 的参数构造、response 里 id/version
 * 的字段路径——让 3.3 的 driver（codexAppServer.ts）只依赖这个稳定接口，**不直接写死 0.137 的字段名**。
 * 将来 codex 协议版本变了，只换一个 adapter 实现，driver 不动。
 *
 * 全部纯函数、无状态：输入 → 输出对象，不碰 process / jsonRpc / 累计态。
 *
 * 形状来源：probe-notes.md §0/§1（0.137 实测）。参数映射多为 identity——contract 的枚举
 * （CodexApproval/CodexSandbox/effort）是按 codex 字符串设计的，直接透传即可。
 */

/** thread/start 入参（缺省字段省略；sandbox/approval 透传 contract 枚举字符串）。 */
export interface ThreadStartParams {
  cwd: string
  model?: string
  approvalPolicy?: string
  sandbox?: string
}

/** thread/resume 入参（按 thread id 续接，baseline ThreadResumeParams）。 */
export interface ThreadResumeParams {
  threadId: string
}

/** turn/start 入参（input 固定 text 块；effort 透传 ReasoningEffort）。 */
export interface TurnStartParams {
  threadId: string
  input: Array<{ type: 'text'; text: string; text_elements: never[] }>
  effort?: string
}

/** driver 起 turn 时透传给参数构造的档位子集（codex 专属，无 claude 的 permissionMode）。 */
export interface CodexTurnParamOpts {
  model?: string
  approval?: string
  sandbox?: string
  effort?: string
}

/** initialize 入参（probe §0：clientInfo + capabilities 固定形）。 */
export interface InitializeParams {
  clientInfo: { name: string; title: null; version: string }
  capabilities: { experimentalApi: true; requestAttestation: false }
}

/**
 * 协议适配器接口：driver 通过它构造请求参数 / 从 response 取关键字段。
 * 同一接口可有多个版本实现；当前仅 0.137 一版（CodexProtocolAdapter0137）。
 */
export interface CodexProtocolAdapter {
  /** 单条 app-server 通知 → 0..n AgentEvent（委托 eventMap 纯映射）。 */
  mapEvent(method: string, params: unknown): AgentEvent[]
  /** 子线程 item → CodexSubItem 块（Phase 5 subagent；started 区分 item/started vs item/completed）。无内容→null。 */
  mapSubItem(item: unknown, started: boolean): CodexSubItem | null
  /** initialize 入参（含 daemon 版本号写进 clientInfo.version）。 */
  buildInitializeParams(): InitializeParams
  /** thread/start 入参（cwd/model/approval/sandbox；缺省省略）。 */
  buildThreadStartParams(opts: { cwd: string } & CodexTurnParamOpts): ThreadStartParams
  /** thread/resume 入参（按存的 thread id 续接）。 */
  buildThreadResumeParams(threadId: string): ThreadResumeParams
  /** turn/start 入参（prompt → text 块；effort 透传）。 */
  buildTurnStartParams(threadId: string, text: string, opts: CodexTurnParamOpts): TurnStartParams
  /** turn/interrupt 入参（必须带 turnId，否则 -32600，见 probe §1）。 */
  buildInterruptParams(threadId: string, turnId: string): { threadId: string; turnId: string }
  /** 从 thread/start(或 resume) response 取 threadId（= result.thread.id）。 */
  extractThreadId(threadStartResult: unknown): string
  /** 从 turn/started notification 的 params 取 turnId（= params.turn.id，NOT params.turnId）。 */
  extractTurnId(turnStartedParams: unknown): string
  /** 从 initialize response 取 codex 版本（正则抓 userAgent 第一个 x.y.z；Phase 8 复用）。无则 undefined。 */
  extractVersion(initializeResult: unknown): string | undefined
}

/** 0.137 协议适配器实现。version = daemon 自身版本号（写进 initialize.clientInfo.version）。 */
export class CodexProtocolAdapter0137 implements CodexProtocolAdapter {
  constructor(private readonly version: string = '0.0.0') {}

  mapEvent(method: string, params: unknown): AgentEvent[] {
    return mapAppServerEvent(method, params)
  }

  mapSubItem(item: unknown, started: boolean): CodexSubItem | null {
    return mapItemToSubItem(item, started)
  }

  buildInitializeParams(): InitializeParams {
    return {
      clientInfo: { name: 'agent-shell', title: null, version: this.version },
      capabilities: { experimentalApi: true, requestAttestation: false },
    }
  }

  buildThreadStartParams(opts: { cwd: string } & CodexTurnParamOpts): ThreadStartParams {
    const p: ThreadStartParams = { cwd: opts.cwd }
    if (opts.model !== undefined) p.model = opts.model
    if (opts.approval !== undefined) p.approvalPolicy = opts.approval
    if (opts.sandbox !== undefined) p.sandbox = opts.sandbox
    return p
  }

  buildThreadResumeParams(threadId: string): ThreadResumeParams {
    return { threadId }
  }

  buildTurnStartParams(threadId: string, text: string, opts: CodexTurnParamOpts): TurnStartParams {
    const p: TurnStartParams = {
      threadId,
      input: [{ type: 'text', text, text_elements: [] }],
    }
    if (opts.effort !== undefined) p.effort = opts.effort
    return p
  }

  buildInterruptParams(threadId: string, turnId: string): { threadId: string; turnId: string } {
    return { threadId, turnId }
  }

  extractThreadId(threadStartResult: unknown): string {
    const id = (threadStartResult as { thread?: { id?: unknown } } | null | undefined)?.thread?.id
    if (typeof id !== 'string' || !id) throw new Error('thread/start response missing thread.id')
    return id
  }

  extractTurnId(turnStartedParams: unknown): string {
    const id = (turnStartedParams as { turn?: { id?: unknown } } | null | undefined)?.turn?.id
    if (typeof id !== 'string' || !id) throw new Error('turn/started params missing turn.id')
    return id
  }

  extractVersion(initializeResult: unknown): string | undefined {
    const ua = (initializeResult as { userAgent?: unknown } | null | undefined)?.userAgent
    if (typeof ua !== 'string') return undefined
    const m = ua.match(/\d+\.\d+\.\d+/)
    return m ? m[0] : undefined
  }
}
