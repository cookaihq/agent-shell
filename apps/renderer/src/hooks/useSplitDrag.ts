// useSplitDrag — 移植原型 app.js 工作区分隔条拖拽 IIFE (L965-989)
// 通用「左 | 把手 | 1fr」三列网格的拖拽 hook，外层工作区分隔条 + 内层文件浏览器分隔条共用。
// 用法：把 containerRef 绑到容器（grid 三列），handleProps 绑到把手元素，cols 写回 gridTemplateColumns。
// 返回: { containerRef, handleProps, cols }
//   containerRef: 绑定到三列网格容器元素
//   handleProps:  绑定到把手元素 { onMouseDown }
//   cols:         gridTemplateColumns 字符串（undefined 表示用 CSS 默认值）
//
// 参数（可选，默认为外层工作区分隔条的值）：
//   minLeft:  左列最小宽度（外层 360 = 聊天栏工具条放得下的下限；内层目录树 150）
//   minRight: 右列最小宽度（外层 360；内层文件列表 240）

import { useEffect, useRef, useState } from 'react'

const HANDLE = 6

interface SplitDragOptions {
  minLeft?: number
  minRight?: number
}

export function useSplitDrag(options: SplitDragOptions = {}) {
  const { minLeft = 360, minRight = 360 } = options
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [cols, setCols] = useState<string | undefined>(undefined)
  const dragging = useRef(false)

  useEffect(() => {
    const move = (e: MouseEvent) => {
      if (!dragging.current || !containerRef.current) return
      const rect = containerRef.current.getBoundingClientRect()
      const max = rect.width - HANDLE - minRight
      const left = Math.max(minLeft, Math.min(e.clientX - rect.left, max))
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
  }, [minLeft, minRight])

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
