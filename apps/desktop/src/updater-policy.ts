/**
 * 更新检查的纯策略逻辑（不依赖 electron，可单测）。
 *
 * updater.ts 重度耦合 electron（app/dialog/autoUpdater），在 ELECTRON_RUN_AS_NODE 下拿不到这些 API，
 * 无法直接单测。故把有真实判断的两块——失败退避、同版本去重——抽到这里，由 updater-policy.test.ts 覆盖；
 * updater.ts 只负责把它们接到 electron 事件上。
 */

/** 正常巡检间隔：6 小时（对齐 open-design stable 通道节奏）。 */
export const CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000

/** 失败退避起步：首次失败后 60s 重试。 */
export const BACKOFF_INITIAL_MS = 60_000

/** 失败退避上限：最长 30min 一次（对齐 open-design）。 */
export const BACKOFF_MAX_MS = 30 * 60_000

/**
 * 连续失败的指数退避：第 n 次失败后等 min(60s · 2^(n-1), 30min) 再重试。
 * 这样一次网络抖动 60s 就重试，持续失败也不会高频砸一个挂掉的 feed。
 *
 * @param failureStreak 连续失败次数（1 起算）
 */
export function nextBackoffDelay(
  failureStreak: number,
  opts: { initialMs?: number; maxMs?: number } = {},
): number {
  const initialMs = opts.initialMs ?? BACKOFF_INITIAL_MS
  const maxMs = opts.maxMs ?? BACKOFF_MAX_MS
  const n = Math.max(1, Math.floor(failureStreak))
  const delay = initialMs * 2 ** (n - 1)
  return Math.min(delay, maxMs)
}

/**
 * 同一版本本轮只提示一次（P2 去重）。
 *
 * 周期巡检一上，同一个待更新版本会被反复 `update-available`——没有去重就会反复弹框打断用户。
 * 这里按版本号记账：见过的版本（或空版本）一律不再提示。进程内存态，重启即清空（重启理应重新提醒）。
 */
export function createVersionPromptGate(): { shouldPrompt(version: string | undefined | null): boolean } {
  const prompted = new Set<string>()
  return {
    shouldPrompt(version) {
      if (!version || prompted.has(version)) return false
      prompted.add(version)
      return true
    },
  }
}
