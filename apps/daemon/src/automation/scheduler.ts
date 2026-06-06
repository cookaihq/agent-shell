import type Database from 'better-sqlite3'
import type { AutomationTrigger } from '@agent-shell/contracts'
import { getAutomation, listEnabledAutomations, setNextRunAt, type AutomationRow } from '../db/automations'
import { nextRunAtForSchedule } from './nextRun'

/** 到点跑一条自动化的 handler（Phase 4 注入）：建会话、跑 prompt、收尾写 run。 */
export type AutomationRunHandler = (automation: AutomationRow, trigger: AutomationTrigger) => Promise<void>

/** 注入的定时器抽象（测试用 fake 捕获回调手动触发，避免 fake-timer 脆弱）。 */
type TimerHandle = unknown
export interface SchedulerDeps {
  db: Database.Database
  now?: () => number
  setTimer?: (cb: () => void, delayMs: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
}

// setTimeout 上限 ~24.8 天（2^31 ms）：超出要 cap + 链式重排。最小 1s 防 0 延迟空转。
const DELAY_CAP_MS = 2_000_000_000
const MIN_DELAY_MS = 1_000

/**
 * 自动化定时调度器（单实例；不搬 open-design 的多 daemon 抢槽）。
 * 给每条「启用中」自动化算 nextRunAt 挂定时器；到点调 runHandler；无论成败重排下一次保持节奏。
 * 进程内 inflight 去重：同条自动化「手动立即跑」与「定时触发」撞一起 → 复用同一 Promise，不并发跑两份。
 */
export class AutomationScheduler {
  private timers = new Map<string, { handle: TimerHandle; fireAt: number }>()
  private inflight = new Map<string, Promise<void>>()
  private runHandler: AutomationRunHandler | null = null
  private now: () => number
  private setTimer: (cb: () => void, delayMs: number) => TimerHandle
  private clearTimer: (handle: TimerHandle) => void

  constructor(private deps: SchedulerDeps) {
    this.now = deps.now ?? Date.now
    this.setTimer = deps.setTimer ?? ((cb, ms) => {
      const t = setTimeout(cb, ms)
      if (typeof (t as { unref?: () => void }).unref === 'function') (t as { unref: () => void }).unref()
      return t
    })
    this.clearTimer = deps.clearTimer ?? ((h) => clearTimeout(h as ReturnType<typeof setTimeout>))
  }

  setRunHandler(fn: AutomationRunHandler): void { this.runHandler = fn }

  /** 启动：给所有启用中的自动化排定时器（daemon 起来时调一次）。 */
  armAll(): void {
    for (const a of listEnabledAutomations(this.deps.db)) this.armOne(a)
  }

  private armOne(a: AutomationRow): void {
    const next = nextRunAtForSchedule(a.schedule, this.now())
    setNextRunAt(this.deps.db, a.id, next)
    if (next == null) return
    const delay = Math.max(MIN_DELAY_MS, Math.min(DELAY_CAP_MS, next - this.now()))
    const handle = this.setTimer(() => this.onFire(a.id, next), delay)
    this.timers.set(a.id, { handle, fireAt: next })
  }

  /** 定时器到点：若是 cap 的中间唤醒（还没真到点）→ 仅重排；真到点 → 跑一次，无论成败重排下一次。 */
  private onFire(id: string, fireAt: number): void {
    this.timers.delete(id)
    if (this.now() < fireAt) { this.reschedule(id); return }
    void this.start(id, 'scheduled').finally(() => this.reschedule(id))
  }

  /** 立即手动跑（trigger=manual）。 */
  runNow(id: string): Promise<void> { return this.start(id, 'manual') }

  /** inflight 去重 + 调 runHandler。 */
  private start(id: string, trigger: AutomationTrigger): Promise<void> {
    const existing = this.inflight.get(id)
    if (existing) return existing
    const a = getAutomation(this.deps.db, id)
    if (!a || !this.runHandler) return Promise.resolve()
    const p = this.runHandler(a, trigger).catch((err) => {
      console.error(`[automation] run ${id} (${trigger}) 失败:`, err instanceof Error ? err.message : err)
    })
    this.inflight.set(id, p)
    void p.finally(() => { this.inflight.delete(id) })
    return p
  }

  /** 重排某条（编辑/启停/触发后调）：取消旧定时器，按最新行重新算。enabled=false → 仅取消并清 nextRunAt。 */
  reschedule(id: string): void {
    this.cancelTimer(id)
    const a = getAutomation(this.deps.db, id)
    if (!a || !a.enabled) { setNextRunAt(this.deps.db, id, null); return }
    this.armOne(a)
  }

  /** 取消某条的定时器并清 nextRunAt（删除/暂停用）。 */
  cancel(id: string): void {
    this.cancelTimer(id)
    setNextRunAt(this.deps.db, id, null)
  }

  private cancelTimer(id: string): void {
    const t = this.timers.get(id)
    if (t) { this.clearTimer(t.handle); this.timers.delete(id) }
  }

  /** 关停所有定时器（daemon 关闭）。 */
  stop(): void {
    for (const { handle } of this.timers.values()) this.clearTimer(handle)
    this.timers.clear()
  }
}
