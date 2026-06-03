/**
 * CtxFile.tsx — Task 18
 *
 * 当前打开文件上下文卡片。移植 app.js ctxFile / ctxExcluded 前端逻辑 (L468-482)。
 *
 * 结构（对齐原型 workspace.html L69）：
 *   button.ctx-file[.is-off][hidden]
 *     > span.cf-sep + svg.cf-ic + span.cf-name
 *
 * activeFile 来自文件区（Task 19/20 还没做）。
 * Task 18 只建组件 + ctxExcluded 前端态；Composer 此刻传 activeFile=null → hidden。
 * 真正的 activeFile 联动留 Task 20 接。
 */
import { useState } from 'react'

// 文件图标 SVG（对齐原型 workspace.html L69 ctx-file 内联 SVG）
const FileIc = () => (
  <svg
    className="cf-ic"
    width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor"
    strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
  >
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
)

interface CtxFileProps {
  /** 当前打开的文件名/路径；null 表示无文件或文件浏览器模式 → 隐藏 */
  activeFile: string | null
}

export function CtxFile({ activeFile }: CtxFileProps) {
  // 前端态：记录被用户移出上下文的文件集合
  const [ctxExcluded, setCtxExcluded] = useState<Set<string>>(new Set())

  // activeFile=null 时隐藏（Task 20 接 activeFile 前 Composer 传 null）
  if (!activeFile) {
    return <button className="ctx-file" hidden type="button" />
  }

  const isOff = ctxExcluded.has(activeFile)

  const toggle = () => {
    setCtxExcluded(prev => {
      const next = new Set(prev)
      if (next.has(activeFile)) next.delete(activeFile)
      else next.add(activeFile)
      return next
    })
  }

  return (
    <button
      className={`ctx-file${isOff ? ' is-off' : ''}`}
      type="button"
      title={isOff ? '已移出上下文，点击加回' : '此文件已在上下文中，点击移出'}
      onClick={toggle}
    >
      <span className="cf-sep" />
      <FileIc />
      <span className="cf-name">{activeFile}</span>
    </button>
  )
}
