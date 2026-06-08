import type Database from 'better-sqlite3'
import type { AutomationRunTrigger, AutomationTriggerDef } from '@agent-shell/contracts'
import type { AutomationStore, AutomationRow } from './automationStore'
import { nextRunAtForSchedule } from './nextRun'

/** 到点跑一条自动化的 handler（Phase 4 注入）：建会话、跑 prompt、收尾写 run。 */
export type AutomationRunHandler = (automation: AutomationRow, trigger: AutomationRunTrigger) => Promise<void>

/** 注入的定时器抽象（测试用 fake 捕获回调手动触发，避免 fake-timer 脆弱）。 */
type TimerHandle = unknown
export interface SchedulerDeps {
  db: Database.Database
  store: AutomationStore
  now?: () => number
  setTimer?: (cb: () => void, delayMs: number) => TimerHandle
  clearTimer?: (handle: TimerHandle) => void
}

// setTimeout 上限 ~24.8 天（2^31 ms）：超出要 cap + 链式重排。最小 1s 防 0 延迟空转。
const DELAY_CAP_MS = 2_000_000_000
const MIN_DELAY_MS = 1_000

/**
 * 自动化定时调度器（单实例；不搬 open-design 的多 daemon 抢槽）。
 * 给每条「启用中」自动化的每个 triggers 算 nextRunAt 挂定时器（一个任务多时间触发器=多 timer）；
 * 到点调 runHandler；无论成败重排下一次保持节奏。startup 触发器在 armAll 时立即触发一次（带进程内节流）。
 * 进程内 inflight 去重：同条自动化「手动立即跑」与「定时触发」撞一起 → 复用同一 Promise，不并发跑两份。
 */
export class AutomationScheduler {
  // timer key = `${id}#${triggerIndex}`：一个任务的每条时间触发器一个 timer slot。
  private timers = new Map<string, { handle: TimerHandle; fireAt: number }>()
  private inflight = new Map<string, Promise<void>>()
  private runHandler: AutomationRunHandler | null = null
  private now: () => number
  private setTimer: (cb: () => void, delayMs: number) => TimerHandle
  private clearTimer: (handle: TimerHandle) => void

  // 进程内 startup 节流：同任务 startup 仅「本进程首次 armAll」算一次，
  // 后续 reschedule/再 armAll 不重复触发（防 daemon 内频繁 reschedule 反复跑 startup）。
  // daemon 重启 = 新进程 = 集合清空 → 再触发一次，符合「启动时跑」语义。
  private startupFired = new Set<string>()
  // 停机闸：stop() 后所有调度动作 no-op。防 daemon 关停时，正在完成的 run 的
  // .finally(reschedule) 等异步回调触到正在关闭的 db/store（停机后不应再排期）。
  private stopped = false

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

  /** 时间触发器的 timer key：任务 id + 触发器下标（一个任务多时间触发器 = 多 timer）。 */
  private timerKey(id: string, i: number): string { return `${id}#${i}` }

  /** 启动：给所有启用中的自动化排定时器（daemon 起来时调一次）。 */
  armAll(): void {
    for (const a of this.deps.store.listEnabled()) this.armOne(a)
  }

  private armOne(a: AutomationRow): void {
    // 先清掉该任务所有旧 timer（按前缀），再按当前 triggers 重排
    this.cancelTimers(a.id)
    let earliest: number | null = null
    a.triggers.forEach((trig: AutomationTriggerDef, i) => {
      try {
        if (trig.kind === 'startup') {
          // startup：armAll 时立即触发一次（带节流）；不进 timer、不进 next_run_at
          if (!this.startupFired.has(a.id)) {
            this.startupFired.add(a.id)
            void this.start(a.id, 'scheduled').finally(() => this.reschedule(a.id))
          }
          return
        }
        // 时间触发器：复用 nextRunAtForSchedule（trig 此时即一个 AutomationSchedule 成员）
        const next = nextRunAtForSchedule(trig, this.now())
        if (next == null) return
        if (earliest == null || next < earliest) earliest = next
        const delay = Math.max(MIN_DELAY_MS, Math.min(DELAY_CAP_MS, next - this.now()))
        const handle = this.setTimer(() => this.onFire(a.id, i, next), delay)
        this.timers.set(this.timerKey(a.id, i), { handle, fireAt: next })
      } catch (err) {
        // 坏 trigger（如时区非法）跳过、不崩整个调度器（spec §8 健壮性）
        console.warn(`[automation] ${a.id} trigger[${i}] 排期失败，跳过:`, err instanceof Error ? err.message : err)
      }
    })
    this.deps.store.setNextRunAt(a.id, earliest) // UI 展示「最近一次」= 所有时间触发器里最早
  }

  /** 某条时间触发器到点：cap 中间唤醒 → 仅重排该任务；真到点 → 跑一次，无论成败重排。 */
  private onFire(id: string, i: number, fireAt: number): void {
    this.timers.delete(this.timerKey(id, i))
    if (this.now() < fireAt) { this.reschedule(id); return }
    void this.start(id, 'scheduled').finally(() => this.reschedule(id))
  }

  /** 立即手动跑（trigger=manual）。 */
  runNow(id: string): Promise<void> { return this.start(id, 'manual') }

  /** inflight 去重 + 调 runHandler。 */
  private start(id: string, trigger: AutomationRunTrigger): Promise<void> {
    const existing = this.inflight.get(id)
    if (existing) return existing
    const a = this.deps.store.get(id)
    if (!a || !this.runHandler) return Promise.resolve()
    const p = this.runHandler(a, trigger).catch((err) => {
      console.error(`[automation] run ${id} (${trigger}) 失败:`, err instanceof Error ? err.message : err)
    })
    this.inflight.set(id, p)
    void p.finally(() => { this.inflight.delete(id) })
    return p
  }

  /** 重排某条（编辑/启停/触发后调）：取消该任务所有 timer，按最新行重新排。enabled=false → 仅取消并清 nextRunAt。 */
  reschedule(id: string): void {
    if (this.stopped) return
    this.cancelTimers(id)
    const a = this.deps.store.get(id)
    if (!a || !a.enabled) { this.deps.store.setNextRunAt(id, null); return }
    this.armOne(a)
  }

  /** 取消某条的全部 timer 并清 nextRunAt（删除/暂停用）。 */
  cancel(id: string): void {
    this.cancelTimers(id)
    this.deps.store.setNextRunAt(id, null)
  }

  /** 取消某任务的全部时间触发器 timer（按 `id#` 前缀匹配）。 */
  private cancelTimers(id: string): void {
    const prefix = `${id}#`
    for (const [key, t] of this.timers) {
      if (key.startsWith(prefix)) { this.clearTimer(t.handle); this.timers.delete(key) }
    }
  }

  /** 关停所有定时器（daemon 关闭）。置停机闸，停机后异步回调不再排期。 */
  stop(): void {
    this.stopped = true
    for (const { handle } of this.timers.values()) this.clearTimer(handle)
    this.timers.clear()
  }
}
