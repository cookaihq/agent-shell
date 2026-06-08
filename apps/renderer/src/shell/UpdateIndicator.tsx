import { useEffect, useState } from 'react'
import type { AgentShellBridge, UpdateState } from '@agent-shell/contracts'
import { IconDownload } from '../ui/icons'

function getBridge(): AgentShellBridge | undefined {
  return (globalThis as { agentShell?: AgentShellBridge }).agentShell
}

interface UpdateIndicatorProps {
  update: UpdateState | null
}

/** 顶栏右侧「有可用更新」常驻图标 + 点击气泡。纯展示：状态由父层 useUpdateAvailable 传入。 */
export function UpdateIndicator({ update }: UpdateIndicatorProps) {
  const [open, setOpen] = useState(false)

  // 气泡开着时 Esc 关闭。外部点击关闭由下方全窗口透明背板负责——
  // 不用 document mousedown：气泡渲染在 .chrome 标题栏(-webkit-app-region:drag)里，
  // 点拖拽区时系统吞掉 mousedown 用于拖窗口、不发 DOM 事件，document 监听收不到。
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('keydown', onKey, true)
    return () => document.removeEventListener('keydown', onKey, true)
  }, [open])

  if (!update) return null

  const openDownload = () => {
    setOpen(false)
    void getBridge()?.openExternal(update.releasesUrl)
  }

  return (
    <div className="chrome-update">
      <button
        type="button"
        className="chrome-icon chrome-update-btn"
        title={`发现新版本 ${update.version}`}
        aria-label={`发现新版本 ${update.version}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        onClick={() => setOpen((v) => !v)}
      >
        <IconDownload size={16} />
        <span className="chrome-update-dot" />
      </button>
      {open && (
        <>
          {/* 全窗口透明背板：捕获气泡外的任何点击（含标题栏拖拽区）→ 关闭。no-drag 让它真正收到点击。 */}
          <div className="chrome-update-backdrop" onMouseDown={() => setOpen(false)} />
          <div className="chrome-update-pop" role="dialog">
            <div className="chrome-update-pop-title">发现新版本 {update.version}</div>
            <button type="button" className="chrome-update-pop-btn" onClick={openDownload}>打开下载页</button>
          </div>
        </>
      )}
    </div>
  )
}
