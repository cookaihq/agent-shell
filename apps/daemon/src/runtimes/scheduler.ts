import { spawn as nodeSpawn, type ChildProcess } from 'node:child_process'
import type { AgentEvent, Engine } from '@agent-shell/contracts'
import { sanitizeEnv } from './env'
import { LineBuffer } from './lineBuffer'
import { getRuntimeDef } from './registry'
import type { BuildArgsOpts, ProviderCreds } from './types'

export interface RunTurnOpts {
  engine: Engine
  /** detection 解析出的绝对路径。 */
  binPath: string
  cwd: string
  model: string
  prompt: string
  permissionMode?: string       // claude
  sandbox?: string              // codex
  /** 需授权读取的项目外目录集（消息附件引用项目外路径时）。 */
  addDirs?: string[]
  /** 引擎侧 resume 指针（codex thread_id / claude session_id）；有则起进程时拼 resume 旗标。 */
  resumableId?: string
  creds?: ProviderCreds         // BYOK（V1 不传）
  baseEnv?: NodeJS.ProcessEnv   // 默认 process.env
  onEvent: (ev: AgentEvent) => void
  /** 嗅探到引擎侧 resume 指针（claude session_id / codex thread_id）时回调，每 turn 至多一次。 */
  onResumableId?: (id: string) => void
  /** 每个 turn_end 事件触发一次（含合成的终结）；上层据此决定续投/收尾。 */
  onTurnEnd?: (stopReason: string) => void
  /** 可注入（测试用假子进程）；默认 node:child_process.spawn。 */
  spawnFn?: typeof nodeSpawn
}

/** 引擎无关的 turn 句柄子集：SessionRuntime 只依赖这四项驱动续投/中断/收尾。
 *  CliSpawnRuntime（RunTurnHandle）与 ClaudeSdkRuntime（ClaudeSdkHandle）都满足它，使 SessionRuntime 按引擎多态。 */
export interface RuntimeTurnHandle {
  done: Promise<{ exitCode: number | null }>
  /** 中断本 turn。 */
  interrupt: (graceMs?: number) => void
  /** 续投下一条 user 消息（同会话多轮）。 */
  pushUser: (text: string) => void
  /** 结束输入，让引擎跑完退出。 */
  endInput: () => void
}

export interface RunTurnHandle extends RuntimeTurnHandle {
  child: ChildProcess
  /** 中断本 turn：SIGTERM→宽限(默认 5s)未退→SIGKILL。合成终结用 stopReason 'aborted'。 */
  interrupt: (graceMs?: number) => void
  /** 往活进程 stdin 续写下一条 user 消息（claude 同进程多轮续投）；同时重置 sawTurnEnd 开启新 turn。 */
  pushUser: (text: string) => void
  /** 关闭 stdin；claude 排空后将退出进程。 */
  endInput: () => void
}

/** 合成失败终结的诊断真因：spawn 错误（ENOENT/EACCES）+ 退出码 + stderr 尾部，按可读顺序拼。全空 → undefined。 */
function failDetail(stderr: string, exitCode: number | null, spawnErr?: Error): string | undefined {
  const parts: string[] = []
  if (spawnErr) parts.push(spawnErr.message)
  if (exitCode !== null && exitCode !== 0) parts.push(`exit ${exitCode}`)
  const s = stderr.trim()
  if (s) parts.push(s)
  return parts.length ? parts.join(' · ') : undefined
}

/** 起一轮：spawn 引擎子进程、按 def 喂 prompt、每进程行缓冲地把分块 stdout 归一为内部事件。 */
export function runTurn(opts: RunTurnOpts): RunTurnHandle {
  const def = getRuntimeDef(opts.engine)
  const buildOpts: BuildArgsOpts = { model: opts.model, permissionMode: opts.permissionMode, sandbox: opts.sandbox, resumableId: opts.resumableId, addDirs: opts.addDirs }
  const env = sanitizeEnv(def.authStrategy, opts.baseEnv ?? process.env, opts.creds)
  const spawnFn = opts.spawnFn ?? nodeSpawn

  const child = spawnFn(opts.binPath, def.buildArgs(buildOpts), {
    cwd: opts.cwd,
    env,
    stdio: ['pipe', 'pipe', 'pipe'],
  })

  // stderr ring buffer：失败收尾时作为诊断真因带进 turn_end.detail（别再静默吞掉引擎报错）。
  // 只留尾部 STDERR_CAP 字符——错误信息通常在末尾，且避免长输出占内存。
  const STDERR_CAP = 4000
  let stderrBuf = ''
  child.stderr?.on('data', (d: Buffer) => {
    stderrBuf += d.toString()
    if (stderrBuf.length > STDERR_CAP) stderrBuf = stderrBuf.slice(-STDERR_CAP)
  })

  // 每进程一个行缓冲：分块 stdout → 完整行 → M2 逐行解析 → 内部事件
  const lb = new LineBuffer()
  // 逐行解析器：引擎若提供 createParser（如 claude 流式 progress 需跨行累计），每 turn 起一个 per-run 实例（状态隔离，
  // result 行内部自重置 → 同进程多轮续投也正确）；否则用无状态 parseLine（如 codex）。调度器不硬编码引擎名，仍按 def 多态。
  const parseLine = def.createParser ? def.createParser() : (line: string) => def.parseLine(line)
  let sawTurnEnd = false   // 追踪本 turn 是否已产出终结事件
  let aborted = false      // interrupt() 置位（Task 3 用）；合成终结时区分 aborted/failed
  let resumableSeen = false  // 嗅探 resume 指针：首次拿到后不再重复回调
  let killTimer: ReturnType<typeof setTimeout> | undefined
  const feed = (lines: string[]) => {
    for (const line of lines) {
      if (!resumableSeen && opts.onResumableId) {        // Task 3 的旁路嗅探（保留）
        const id = def.extractResumableId(line)
        if (id) { resumableSeen = true; opts.onResumableId(id) }
      }
      for (const ev of parseLine(line)) {
        if (ev.type === 'turn_end') {
          sawTurnEnd = true
          opts.onTurnEnd?.(ev.stopReason)                // 本 Task 新增：每轮终结回调
        }
        opts.onEvent(ev)
      }
    }
  }
  child.stdout?.on('data', (d: Buffer) => feed(lb.push(d.toString())))

  // 用 'close' 而非 'exit'：'close' 由 Node 保证在所有 stdio 排干后触发，'exit' 触发时 stdout 可能还有未读数据。
  // 在 'close' 里 flush 才能确保无末尾换行的终结行（codex turn.completed / claude result）已入缓冲、不被丢。
  // M6 补：同时监听 child 'error'——spawn 失败（坏 binPath 的 ENOENT/EACCES）可能只发 'error' 不发 'close' →
  //   finalize 兜底确保 done 不永久挂起。settled 守卫保证 error + close 都发时只终结一次。
  let settled = false
  const finalize = (exitCode: number | null, spawnErr?: Error) => {
    if (settled) return
    settled = true
    if (killTimer) clearTimeout(killTimer)   // 进程已退，撤销待发的 SIGKILL
    feed(lb.flush())   // 收尾 flush：吐出无末尾换行的最后一行（终结事件）
    // 兜底：进程关闭而全程无 turn_end（崩溃/被 kill/上游异常未映射/spawn 失败）→ 合成终结，消费者不卡"运行中"
    if (!sawTurnEnd) {
      const stopReason = aborted ? 'aborted' : 'failed'
      // 失败才带 detail（aborted 是用户主动中止，无需诊断）：spawn 错误 message + 退出码 + stderr 尾部。
      const detail = stopReason === 'failed' ? failDetail(stderrBuf, exitCode, spawnErr) : undefined
      opts.onEvent({ type: 'turn_end', stopReason, ...(detail ? { detail } : {}) })
      opts.onTurnEnd?.(stopReason)   // 合成终结也要触发 onTurnEnd（下游 setSessionStatus 落库依赖；对齐 JSDoc）
    }
    resolveDone({ exitCode })
  }
  let resolveDone!: (v: { exitCode: number | null }) => void
  const done = new Promise<{ exitCode: number | null }>((resolve) => { resolveDone = resolve })
  child.on('close', (code) => finalize(code))
  // spawn 失败（坏 binPath）：可能只发 'error' 不发 'close' → 也要终结，否则 done 永挂。err 带 ENOENT/EACCES 真因。
  child.on('error', (err) => finalize(null, err))

  // 喂 prompt；按引擎决定是否关 stdin（claude 常驻不关；codex 单次关）
  child.stdin?.write(def.formatPrompt(opts.prompt))
  if (def.closeStdinAfterPrompt) child.stdin?.end()

  const interrupt = (graceMs = 5000): void => {
    aborted = true
    if (killTimer) clearTimeout(killTimer)   // 重复 interrupt：撤销上一个待发的 SIGKILL，不遗留孤儿计时器
    child.kill('SIGTERM')
    killTimer = setTimeout(() => child.kill('SIGKILL'), graceMs)
  }

  const pushUser = (text: string): void => {
    sawTurnEnd = false               // 新 turn 开始；本轮若异常 close 无 turn_end 仍要合成
    child.stdin?.write(def.formatPrompt(text))
  }
  const endInput = (): void => { child.stdin?.end() }

  return { child, done, interrupt, pushUser, endInput }
}
