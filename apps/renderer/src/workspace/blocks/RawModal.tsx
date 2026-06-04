/**
 * RawModal.tsx — 调试模式原始记录浮层
 *
 * 点 🐞 按钮触发，按需从 GET /sessions/:id/raw?msgId= 取回原始 transcript 记录并展示。
 * 点遮罩 / × 关闭。仅在 debugMode=true 时被渲染（调用方保证）。
 */
import { useEffect } from 'react'

interface RawModalProps {
  json: unknown
  onClose: () => void
}

export function RawModal({ json, onClose }: RawModalProps) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="diff-modal-mask" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="diff-modal" onClick={(e) => e.stopPropagation()}>
        <div className="diff-modal-head">
          <span className="dm-icon">🐞</span>
          <span className="dm-name">原始记录</span>
          <button className="dm-close" type="button" title="关闭" onClick={onClose}>✕</button>
        </div>
        <pre className="code-view" style={{ maxHeight: '70vh', overflow: 'auto', margin: 0, padding: '12px 16px', fontSize: '11.5px', fontFamily: 'ui-monospace, monospace', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
          {JSON.stringify(json, null, 2)}
        </pre>
      </div>
    </div>
  )
}
