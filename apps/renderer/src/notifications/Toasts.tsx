// Toasts.tsx — 瞬时 toast 卡片容器（T8）。portal 到 body，全局浮在右上角。
//
// notify() 时 store 往 toasts 推一条；attention 常驻、complete/failed 约 5s 自消（由 store 计时）。
// 点卡片 → onOpenSession 跳会话 + 关该 toast；点 × → 仅关。容器 .rmd-toasts 复刻原型样式。
import { createPortal } from 'react-dom'
import { useNotifications } from './NotificationsContext'
import { NotifCard } from './NotificationCenter'

interface ToastsProps {
  onOpenSession: (projectId: string, sessionId: string) => void
}

export function Toasts({ onOpenSession }: ToastsProps) {
  const { toasts, dismissToast } = useNotifications()
  if (toasts.length === 0) return null
  return createPortal(
    <div className="rmd-toasts">
      {toasts.map((t) => (
        <NotifCard
          key={t.id}
          event={t.event}
          title={t.title}
          msg={t.msg}
          onOpen={() => { onOpenSession(t.projectId, t.sessionId); dismissToast(t.id) }}
          onClose={() => dismissToast(t.id)}
        />
      ))}
    </div>,
    document.body,
  )
}
