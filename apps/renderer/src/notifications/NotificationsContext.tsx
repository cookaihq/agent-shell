// NotificationsContext.tsx — 提醒（Reminders）全局通知中心 store（T8）
//
// 单一入口 notify()：① 入通知中心列表（亮红点，铃铛下拉里常驻可回看）；② 弹一张瞬时 toast 卡片
// （右上角浮起，attention 常驻、complete/failed 约 5s 自消）。T7 的 inapp 渠道收到事件后调它。
// 本 store 只负责「被调用后怎么显示」，不做触发判定（那是 T7）。
//
// 设计取舍：列表项（持久回看）与 toast（瞬时浮层）是两份状态——
//   - notifications：永远累积，直到 markAllRead 清空 / dismiss 删单条；红点 = 列表非空。
//   - toasts：notify 时新增一条，complete/failed 到点自消、attention 常驻；与列表项相互独立
//     （dismiss 列表项不连带关 toast，反之亦然——两个面是两套生命周期，简化心智）。
import { createContext, useContext, useState, useCallback, useRef, useEffect } from 'react'
import type { ReactNode } from 'react'

export type ReminderEvent = 'attention' | 'complete' | 'failed'

/** 通知中心列表项（铃铛下拉里渲染的一行 + toast 的数据源）。 */
export interface InboxItem {
  id: string
  event: ReminderEvent
  projectId: string
  sessionId: string
  title: string
  msg: string
  ts: number
}

/** notify 入参：调用方只给业务字段，id/ts 由 store 生成。 */
export type NotifyInput = Omit<InboxItem, 'id' | 'ts'>

/** 瞬时 toast 卡片（含 sticky：attention 常驻、complete/failed 到点自消）。 */
export interface ToastItem extends InboxItem {
  sticky: boolean
}

/** complete/failed toast 自动消失时长（ms），对齐原型 wireBell。 */
export const TOAST_TTL_MS = 5000

interface NotificationsCtx {
  notifications: InboxItem[]
  toasts: ToastItem[]
  /** 单一入口：入列表 + 弹 toast。返回新建项 id（便于调用方关联，暂未用）。 */
  notify: (input: NotifyInput) => string
  /** 清空通知中心列表（灭红点）；不连带关已弹出的 toast。 */
  markAllRead: () => void
  /** 关闭通知中心列表里的某条。 */
  dismiss: (id: string) => void
  /** 关闭某张 toast（到点自消 / 手动点 ×）。 */
  dismissToast: (id: string) => void
}

const Ctx = createContext<NotificationsCtx | null>(null)

/**
 * 取通知中心 store。无 Provider 时直接抛错（fail-fast，把误用暴露在开发期）。
 * 消费者必须在 NotificationsProvider 子树内调用；纯展示组件（如 Chrome）不直接消费 store，
 * 由 AppNav 经 chromeRight 插槽注入，故 Chrome 单测无需挂 Provider。
 */
export function useNotifications(): NotificationsCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useNotifications must be used inside NotificationsProvider')
  return c
}

let seq = 0
function nextId(): string {
  seq += 1
  return `rmd-${Date.now()}-${seq}`
}

export function NotificationsProvider({ children }: { children: ReactNode }) {
  const [notifications, setNotifications] = useState<InboxItem[]>([])
  const [toasts, setToasts] = useState<ToastItem[]>([])
  // 每条 toast 的自消定时器，dismiss/卸载时清理，防漏 timer。
  const timers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map())

  const dismissToast = useCallback((id: string) => {
    const t = timers.current.get(id)
    if (t) { clearTimeout(t); timers.current.delete(id) }
    setToasts((prev) => prev.filter((x) => x.id !== id))
  }, [])

  // Provider 卸载时清掉所有 pending 自消定时器，杜绝 setState-after-unmount。
  // ref 不重建、effect 无依赖：仅在挂载/卸载各跑一次，cleanup 读 timers.current 拿到的是卸载那刻的实时集合。
  useEffect(() => () => { timers.current.forEach(clearTimeout); timers.current.clear() }, [])

  const notify = useCallback((input: NotifyInput): string => {
    const id = nextId()
    const item: InboxItem = { ...input, id, ts: Date.now() }
    const sticky = input.event === 'attention'   // 需介入常驻，完成/失败到点自消
    // 新项排到列表顶部（最近的在最上）
    setNotifications((prev) => [item, ...prev])
    setToasts((prev) => [...prev, { ...item, sticky }])
    if (!sticky) {
      const t = setTimeout(() => {
        timers.current.delete(id)
        setToasts((prev) => prev.filter((x) => x.id !== id))
      }, TOAST_TTL_MS)
      timers.current.set(id, t)
    }
    return id
  }, [])

  const markAllRead = useCallback(() => {
    setNotifications([])
  }, [])

  const dismiss = useCallback((id: string) => {
    setNotifications((prev) => prev.filter((x) => x.id !== id))
  }, [])

  return (
    <Ctx.Provider value={{ notifications, toasts, notify, markAllRead, dismiss, dismissToast }}>
      {children}
    </Ctx.Provider>
  )
}
