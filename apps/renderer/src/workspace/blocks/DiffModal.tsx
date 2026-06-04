/**
 * DiffModal.tsx — 编辑卡完整 diff 浮层（Issue 21）
 *
 * 在左侧会话区内浮出（覆盖 chat-log），渲染某次编辑的完整逐行 diff（真 diff，含行号 + 槽标记）。
 * 由编辑卡点击触发；点遮罩 / × / Escape 关闭。
 */
import { useEffect } from 'react'
import { buildDiff } from './diff'
import { DiffLine } from './OpCard'

export interface DiffPayload {
  filePath: string
  oldStr: string
  newStr: string
}

interface DiffModalProps {
  payload: DiffPayload
  onClose: () => void
}

export function DiffModal({ payload, onClose }: DiffModalProps) {
  const diff = buildDiff(payload.oldStr, payload.newStr)
  const name = payload.filePath.split('/').pop() || payload.filePath

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="diff-modal-mask" onClick={onClose}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-modal-head">
          <span className="dm-icon">E</span>
          <span className="dm-name" title={payload.filePath}>{name}</span>
          <span className="dm-stat">+{diff.added} −{diff.removed}</span>
          <button className="dm-close" type="button" title="关闭" onClick={onClose}>✕</button>
        </div>
        <pre className="op-diff vscode diff-modal-body">
          {diff.rows.map((row, i) => <DiffLine key={i} row={row} />)}
        </pre>
      </div>
    </div>
  )
}
