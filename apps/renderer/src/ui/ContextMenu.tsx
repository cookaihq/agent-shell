/**
 * ContextMenu.tsx — 文件浏览器右键菜单的受控浮层（2026-06-05 设计 §5.1）。
 *
 * 纯展示：定位到 (x, y)，超出视口边缘时翻转贴边；点菜单外部 / Esc / 滚动 / 选中某项后关闭。
 * 菜单的状态、items 构造与各操作回调统一放在容器 FileWorkspace，本组件不持有任何业务逻辑。
 */

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

export type MenuItem =
  | { label: string; danger?: boolean; disabled?: boolean; onClick: () => void }
  | { separator: true }

interface ContextMenuProps {
  x: number
  y: number
  items: MenuItem[]
  onClose: () => void
}

const EDGE = 6   // 距视口边缘的安全间距

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  // 翻转贴边：渲染后量自身尺寸，超出视口右/下缘则左/上翻转，整体不超出屏幕。
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth, vh = window.innerHeight
    const nx = x + r.width > vw - EDGE ? Math.max(EDGE, vw - r.width - EDGE) : x
    const ny = y + r.height > vh - EDGE ? Math.max(EDGE, vh - r.height - EDGE) : y
    setPos({ x: nx, y: ny })
  }, [x, y])

  // 关闭触发：外部点击（mousedown 捕获，早于项的 click）、外部右键、Esc、滚动、窗口缩放/失焦。
  useEffect(() => {
    const outside = (e: Event) => { if (ref.current && !ref.current.contains(e.target as Node)) onClose() }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('mousedown', outside, true)
    document.addEventListener('contextmenu', outside, true)
    document.addEventListener('scroll', onClose, true)
    document.addEventListener('keydown', onKey, true)
    window.addEventListener('resize', onClose)
    window.addEventListener('blur', onClose)
    return () => {
      document.removeEventListener('mousedown', outside, true)
      document.removeEventListener('contextmenu', outside, true)
      document.removeEventListener('scroll', onClose, true)
      document.removeEventListener('keydown', onKey, true)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return (
    <div
      ref={ref}
      className="ctx-menu"
      role="menu"
      style={{ left: pos.x, top: pos.y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((it, i) =>
        'separator' in it ? (
          <div key={`sep-${i}`} className="ctx-menu-sep" />
        ) : (
          <button
            key={`${it.label}-${i}`}
            type="button"
            role="menuitem"
            className={`ctx-menu-item${it.danger ? ' danger' : ''}`}
            disabled={it.disabled}
            onClick={() => { onClose(); it.onClick() }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  )
}
