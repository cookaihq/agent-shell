import { app, dialog, Notification, shell } from 'electron'
import electronUpdater from 'electron-updater'
import { CHECK_INTERVAL_MS, createVersionPromptGate, nextBackoffDelay } from './updater-policy'

// mac 未签名不能自动更新（spec §10-#2）→ 引导用户到 Releases 页手动下载。
// 公开镜像仓 Releases 页（与 apps/desktop/electron-builder.yml 的 publish 保持一致）。
const RELEASES_PAGE = 'https://github.com/cookaihq/agent-shell/releases/latest'

/**
 * 接入自动更新（spec §4）：仅打包态运行、全程 fail-soft（更新检查失败绝不崩主进程）。
 *
 * 巡检策略（updater-policy.ts，可单测）：
 * - 启动先查一次，之后每 {@link CHECK_INTERVAL_MS}（6h）巡检一次——用户长时间不重启也能收到更新。
 * - 检查失败按指数退避重排（60s→…→30min），不高频砸挂掉的 feed。
 * - mac 同一版本本轮只弹一次框（去重），避免周期巡检反复打断用户。
 *
 * 平台差异：
 * - Windows：自动下载 + 退出时安装（unsigned NSIS 可走通）。
 * - mac：未签名不能自动更新——检查到新版 → 弹框 → 开 Releases 页手动下载。
 */
export function initUpdater(): void {
  if (!app.isPackaged) return // dev 不查更新

  // 守卫之后才解构 autoUpdater：electron-updater 的该 getter 会急切构造 MacUpdater，
  // 并访问 require('electron').autoUpdater（原生 Squirrel）。放在守卫后，dev 态彻底不碰
  // electron-updater；也使本模块可在 Electron 运行时之外被 import 而不崩（顶层无副作用）。
  const { autoUpdater } = electronUpdater

  const promptGate = createVersionPromptGate()
  let failureStreak = 0
  let timer: ReturnType<typeof setTimeout> | null = null

  const scheduleNext = (delayMs: number): void => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(runCheck, delayMs)
    timer.unref?.() // 别让巡检定时器拖住进程退出
  }

  const runCheck = (): void => {
    // 错误统一走 'error' 事件做退避，这里 catch 只兜底不重复处理。
    autoUpdater.checkForUpdates().catch((e) => console.error('[updater] 检查失败:', e?.message ?? e))
  }

  autoUpdater.on('error', (err) => {
    // 占位 feed / 离线 / 无新版都可能到这——fail-soft，不因更新检查崩主进程。
    failureStreak += 1
    const delay = nextBackoffDelay(failureStreak)
    console.error(`[updater] 更新检查失败（fail-soft，${Math.round(delay / 1000)}s 后重试）:`, err?.message ?? err)
    scheduleNext(delay)
  })

  // 检查成功（无论有无新版）→ 清零失败计数，恢复正常巡检节奏。
  autoUpdater.on('update-not-available', () => {
    failureStreak = 0
    scheduleNext(CHECK_INTERVAL_MS)
  })
  autoUpdater.on('update-available', () => {
    failureStreak = 0
    scheduleNext(CHECK_INTERVAL_MS)
  })

  if (process.platform === 'darwin') {
    autoUpdater.autoDownload = false
    autoUpdater.on('update-available', (info) => {
      if (!promptGate.shouldPrompt(info.version)) return // 同版本本轮已弹过，不再打断
      void dialog
        .showMessageBox({
          type: 'info',
          message: `发现新版本 ${info.version}`,
          detail: 'macOS 版需手动下载更新。是否打开下载页？',
          buttons: ['打开下载页', '稍后'],
          defaultId: 0,
          cancelId: 1,
        })
        .then((r) => {
          if (r.response === 0) return shell.openExternal(RELEASES_PAGE)
        })
        .catch(() => undefined)
    })
  } else {
    // Windows 及其它：autoDownload 默认开，检测到新版自动下载；下载完成系统通知，electron-updater 退出时自动安装。
    autoUpdater.on('update-downloaded', (info) => {
      if (Notification.isSupported()) {
        new Notification({
          title: 'Agent Shell 更新就绪',
          body: `新版本 ${info.version} 已下载，退出应用时自动安装。`,
        }).show()
      }
    })
  }

  runCheck() // 启动先查一次，后续由事件驱动重排
}
