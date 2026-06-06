/**
 * RenameInput.tsx — 文件浏览器内联重命名输入框（2026-06-05 设计 §5.5）。
 *
 * 复用「新建」的内联输入模式：进入即聚焦并选中文件名主体（不含扩展名），Enter 提交 / Esc 取消 / 失焦提交。
 * FileTree 节点内、FileList 行/格/画廊缩略 内共用本组件（编辑态的归属仍各自维护在父层）。
 * keyDown 全部 stopPropagation：避免输入时触发 FileList 的键盘多选 / 树导航。
 */
import { useRef, useState } from 'react'

/** 内联重命名上下文（path=正在改名的项；null=无）。容器统一持有，按 source 分发给 tree / list。 */
export interface RenameCtx { path: string | null; submit: (path: string, newName: string) => void; cancel: () => void }

export function RenameInput({ name, onSubmit, onCancel, className = 'fb-rename-input' }: {
  name: string
  onSubmit: (newName: string) => void
  onCancel: () => void
  className?: string
}) {
  const [draft, setDraft] = useState(name)
  const done = useRef(false)   // 防 Esc/Enter 后 onBlur 再次触发提交

  const finish = (commit: boolean) => {
    if (done.current) return
    done.current = true
    const v = draft.trim()
    if (commit && v && v !== name) onSubmit(v)
    else onCancel()             // 空 / 未改 / 取消：退出编辑态，不调接口
  }

  return (
    <input
      className={className}
      autoFocus
      value={draft}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); finish(true) }
        else if (e.key === 'Escape') { e.preventDefault(); finish(false) }
      }}
      onBlur={() => finish(true)}
      onFocus={(e) => { const dot = name.lastIndexOf('.'); e.currentTarget.setSelectionRange(0, dot > 0 ? dot : name.length) }}
    />
  )
}
