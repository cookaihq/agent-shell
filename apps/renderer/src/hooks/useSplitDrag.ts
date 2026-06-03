// useSplitDrag — 移植原型 app.js 工作区分隔条拖拽 IIFE (L965-989)
// 用法：在持有 .split 的 Workspace 组件中使用（Task 14），AppShell 只持有外框
// 返回: { containerRef, handleProps, cols }
//   containerRef: 绑定到 .split 容器元素
//   handleProps:  绑定到 .split-handle 元素 { onMouseDown }
//   cols:         gridTemplateColumns 字符串（undefined 表示用 CSS 默认值）

import { useEffect, useRef, useState } from 'react'

const MIN_LEFT = 320
const MIN_RIGHT = 360
const HANDLE = 6

export function useSplitDrag() {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [cols, setCols] = useState<string | undefined>(undefined)
  const dragging = useRef(false)

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const max = rect.width - HANDLE - MIN_RIGHT
      const left = Math.max(MIN_LEFT, Math.min(e.clientX - rect.left, max))
      setCols(`${left}px ${HANDLE}px 1fr`)
    }
    const up = () => {
      if (dragging.current) {
        dragging.current = false
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
    document.addEventListener('mousemove', move)
    document.addEventListener('mouseup', up)
    return () => {
      document.removeEventListener('mousemove', move)
      document.removeEventListener('mouseup', up)
    }
  }, [])

  const handleProps = {
    onMouseDown: (e: { preventDefault: () => void }) => {
      e.preventDefault()
      dragging.current = true
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    },
  }

  return { containerRef, handleProps, cols }
}
