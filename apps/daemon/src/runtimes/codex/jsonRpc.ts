import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import { LineBuffer } from '../lineBuffer'

/**
 * Codex app-server 的【纯传输层】：JSON-RPC over newline-delimited JSON / stdio。
 *
 * 只负责「编解码 + 收发关联 + 进程生命周期」，**不含任何 codex 业务语义**
 * （event→AgentEvent 映射、审批决策、thread/turn 逻辑都在 Phase 3/4，本层不碰）。
 *
 * 线上三类消息（Phase 0 真机探测，见 codex/probe-notes.md §0）：
 *   1. 我方 request 的 response：`{id, result}` 或 `{id, error:{code,message}}`。
 *   2. server→client request（如审批）：`{method, id, params}`（**同时**有 method 与 id），我方须回 `{id, result}`。
 *   3. notification：`{method, params}`（**无 id**）。
 * 判别铁律：**先看有没有 `method`**——有 method = request/notification（按有无 id 再分），
 * 无 method = response。绝不按 id 查表来判类型（审批 request 的 id 真机从 0 起，可能撞我方号）。
 */

export interface CodexJsonRpcOpts {
  /** detection 解析出的 codex 绝对路径。 */
  binPath: string
  /** 启动参数，通常 `['app-server']`（可叠加 `-c` Provider 覆盖等）。 */
  args?: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  /** 可注入（测试用假子进程）；默认 node:child_process.spawn。 */
  spawnFn?: typeof nodeSpawn
  /** notification（无 id）派发：method + params 原样上抛，由 Phase 3 映射。 */
  onNotification: (method: string, params: unknown) => void
  /** server→client request（method+id）派发：上层处理后用 respond(id, result) 回执。 */
  onServerRequest: (method: string, id: number, params: unknown) => void
  /** 进程退出/spawn 失败回调（close 或 error，只触发一次）。 */
  onExit?: (code: number | null, err?: Error) => void
}

interface Pending {
  resolve: (result: unknown) => void
  reject: (err: Error) => void
}

const STDERR_CAP = 4000

export class CodexJsonRpcClient {
  private readonly opts: CodexJsonRpcOpts
  private readonly child: ChildProcess
  private readonly lb = new LineBuffer()
  private readonly pending = new Map<number, Pending>()
  private nextId = 1
  private stderrBuf = ''
  private settled = false
  private killTimer: ReturnType<typeof setTimeout> | undefined

  constructor(opts: CodexJsonRpcOpts) {
    this.opts = opts
    const spawnFn = opts.spawnFn ?? nodeSpawn
    this.child = spawnFn(opts.binPath, opts.args ?? [], {
      cwd: opts.cwd,
      env: opts.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    // stderr ring buffer：失败收尾时作诊断真因（只留尾部 STDERR_CAP 字符）。
    this.child.stderr?.on('data', (d: Buffer) => {
      this.stderrBuf += d.toString()
      if (this.stderrBuf.length > STDERR_CAP) this.stderrBuf = this.stderrBuf.slice(-STDERR_CAP)
    })

    // 分块 stdout → 完整行 → 逐行解码派发。
    this.child.stdout?.on('data', (d: Buffer) => {
      for (const line of this.lb.push(d.toString())) this.handleLine(line)
    })

    // 用 'close'（stdio 排干后触发）而非 'exit'：先 flush LineBuffer 尾巴再收尾。
    this.child.on('close', (code) => this.finalize(code))
    // spawn 失败（坏 binPath ENOENT/EACCES）可能只发 'error' 不发 'close' → 也要收尾，否则 pending 永挂。
    this.child.on('error', (err) => this.finalize(null, err))
  }

  /** 发一条 request：分配递增 id，写出一行，pending 表登记 {resolve,reject}。 */
  request<T = unknown>(method: string, params?: unknown): Promise<T> {
    const id = this.nextId++
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: unknown) => void, reject })
      this.writeLine({ method, id, params })
    })
  }

  /** 回执 server→client request（如审批决策）：写出 `{id, result}` 一行。 */
  respond(id: number, result: unknown): void {
    this.writeLine({ id, result })
  }

  /** 主动关闭：SIGTERM → 宽限未退 → SIGKILL；pending 由 close/error 收尾时统一 reject。 */
  close(graceMs = 5000): void {
    if (this.killTimer) clearTimeout(this.killTimer)
    this.child.kill('SIGTERM')
    this.killTimer = setTimeout(() => this.child.kill('SIGKILL'), graceMs)
  }

  /** 别名：与生命周期 dispose 语义一致。 */
  dispose(graceMs?: number): void {
    this.close(graceMs)
  }

  /** 解码一行并派发到对应通道；坏行/空行跳过不崩。 */
  private handleLine(line: string): void {
    if (!line.trim()) return
    let msg: any
    try {
      msg = JSON.parse(line)
    } catch {
      // 流可能交错/含非 JSON 噪声——跳过单行，不拖垮整个 client。
      console.warn('[codex jsonRpc] skip non-JSON line:', line.slice(0, 200))
      return
    }
    if (msg == null || typeof msg !== 'object') return

    // 判别：有 method 即 request/notification；无 method 即 response。绝不按 id 反查类型。
    if (typeof msg.method === 'string') {
      if (msg.id !== undefined && msg.id !== null) {
        this.opts.onServerRequest(msg.method, msg.id, msg.params)   // server→client request
      } else {
        this.opts.onNotification(msg.method, msg.params)            // notification
      }
      return
    }
    // response：匹配我方 pending id。
    if (msg.id !== undefined && msg.id !== null) {
      const p = this.pending.get(msg.id)
      if (!p) return   // 无主响应（迟到/重复）：忽略。
      this.pending.delete(msg.id)
      if (msg.error) {
        const e = msg.error
        p.reject(new Error(`codex app-server error ${e?.code ?? '?'}: ${e?.message ?? 'unknown'}`))
      } else {
        p.resolve(msg.result)
      }
    }
  }

  private writeLine(obj: unknown): void {
    this.child.stdin?.write(JSON.stringify(obj) + '\n')
  }

  /** 收尾：flush 尾行、reject 全部 pending、触发 onExit。settled 守卫保证 close+error 只收一次。 */
  private finalize(code: number | null, spawnErr?: Error): void {
    if (this.settled) return
    this.settled = true
    if (this.killTimer) clearTimeout(this.killTimer)
    // flush LineBuffer 尾巴（无末尾换行的最后一行）再收尾。
    for (const line of this.lb.flush()) this.handleLine(line)

    const detail = this.failDetail(code, spawnErr)
    const err = new Error(`codex app-server exited${detail ? `: ${detail}` : ''}`)
    for (const [, p] of this.pending) p.reject(err)
    this.pending.clear()

    this.opts.onExit?.(code, spawnErr)
  }

  /** 拼诊断真因：spawn 错误 message + 退出码 + stderr 尾部。 */
  private failDetail(code: number | null, spawnErr?: Error): string | undefined {
    const parts: string[] = []
    if (spawnErr) parts.push(spawnErr.message)
    if (code !== null && code !== 0) parts.push(`exit ${code}`)
    const s = this.stderrBuf.trim()
    if (s) parts.push(s)
    return parts.length ? parts.join(' · ') : undefined
  }
}
