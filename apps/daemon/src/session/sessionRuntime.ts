import { spawn as nodeSpawn } from 'node:child_process'
import type Database from 'better-sqlite3'
import type { AgentEvent, Engine } from '@agent-shell/contracts'
import { runTurn, type RunTurnHandle } from '../runtimes/scheduler'
import { getRuntimeDef } from '../runtimes/registry'
import { getSession, setSessionStatus, setResumableId } from '../db/sessions'
import { getProject } from '../db/projects'
import { appendMessage } from '../db/messages'
import { recordUsage } from '../db/usage'
import type { SessionStatus } from '../db/types'
import { truncateEvent, TRUNCATE_LIMIT } from './truncate'

export interface SessionRuntimeDeps {
  db: Database.Database
  resolveBin: (engine: Engine) => string
  spawnFn?: typeof nodeSpawn
  truncateLimit?: number
}

interface SessionState {
  engine: Engine
  model: string
  cwd: string
  running: boolean
  queue: string[]
  handle?: RunTurnHandle
  turn: number                              // 已完成 turn 数
  resumableId: string | null
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
      running: false, queue: [], turn: 0, resumableId: sess.resumableId,
      subscribers: new Set(), blocks: [],
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
    if (!st || !st.running) return
    st.queue.length = 0          // 中断 = 放弃排队的续投
    st.handle?.interrupt()        // SIGTERM→宽限→SIGKILL（runTurn 内置）；合成 turn_end(aborted)
  }

  submit(sessionId: string, text: string): void {
    const st = this.load(sessionId)
    // user 消息立即落库（刷新可见 + 排队也记录）
    appendMessage(this.deps.db, { sessionId, role: 'user', blocks: [{ type: 'text', text }] })
    if (st.running) { st.queue.push(text); return }
    this.startTurn(sessionId, st, text)
  }

  private startTurn(sessionId: string, st: SessionState, text: string): void {
    st.running = true
    st.blocks = []
    st.usage = undefined
    const handle = runTurn({
      engine: st.engine,
      binPath: this.deps.resolveBin(st.engine),
      cwd: st.cwd,
      model: st.model,
      prompt: text,
      resumableId: st.resumableId ?? undefined,
      // M6 用引擎默认权限（claude default 模式 / codex workspace-write）；会话级权限配置留 M7
      spawnFn: this.deps.spawnFn,
      onEvent: (ev) => this.onEvent(st, ev),
      onTurnEnd: (stopReason) => this.onTurnEnd(sessionId, st, stopReason),
      onResumableId: (id) => { st.resumableId = id; setResumableId(this.deps.db, sessionId, id) },
    })
    st.handle = handle
    void handle.done.then(() => this.onDone(sessionId, st))
  }

  private onEvent(st: SessionState, raw: AgentEvent): void {
    const ev = truncateEvent(raw, this.deps.truncateLimit ?? TRUNCATE_LIMIT)
    for (const fn of st.subscribers) fn(ev)
    switch (ev.type) {
      // 落库 block 用 type:'text'（与 user 文本块、M5 messages 约定、MVP spec 一致；内部事件类型是 message，但块语义=纯文本）
      case 'message': st.blocks.push({ type: 'text', text: ev.text }); break
      case 'thinking': st.blocks.push({ type: 'thinking', text: ev.text }); break
      case 'tool_use': st.blocks.push({ type: 'tool_use', id: ev.id, name: ev.name, input: ev.input }); break
      case 'tool_result': st.blocks.push({ type: 'tool_result', toolUseId: ev.toolUseId, ok: ev.ok, content: ev.content }); break
      case 'usage': st.usage = { inputTokens: ev.inputTokens, outputTokens: ev.outputTokens, costUsd: ev.costUsd }; break
      case 'turn_end': break   // 落库在 onTurnEnd 统一做
    }
  }

  private onTurnEnd(sessionId: string, st: SessionState, stopReason: string): void {
    const db = this.deps.db
    const turnNo = st.turn + 1
    if (st.blocks.length > 0) {
      appendMessage(db, { sessionId, role: 'assistant', blocks: st.blocks })
    }
    if (st.usage) {
      recordUsage(db, { sessionId, turn: turnNo, ...st.usage })
    }
    setSessionStatus(db, sessionId, mapStatus(stopReason))
    st.turn = turnNo
    st.blocks = []
    st.usage = undefined
    // claude 同进程多轮（turnBoundary='event'）：正常完成才续投/收尾；失败/中止说明进程已死/将死，清队列交 onDone
    if (getRuntimeDef(st.engine).turnBoundary === 'event') {
      if (stopReason === 'failed' || stopReason === 'aborted') {
        st.queue.length = 0                       // 进程已死/将死，放弃排队的续投
      } else {
        const next = st.queue.shift()
        if (next !== undefined) st.handle?.pushUser(next)   // 同进程下一轮
        else st.handle?.endInput()                          // 队列空 → 关 stdin 让进程退出
      }
    }
  }

  private onDone(sessionId: string, st: SessionState): void {
    st.handle = undefined
    const next = st.queue.shift()
    if (next !== undefined) {
      // 队列有残留 → 起新进程 resume 投递：codex 正常续投；claude 是 endInput→close 排空窗口期进来的消息。
      // 两引擎都用 st.resumableId（claude --resume / codex resume 子命令），不丢消息。
      this.startTurn(sessionId, st, next)
    } else {
      st.running = false
    }
  }
}
