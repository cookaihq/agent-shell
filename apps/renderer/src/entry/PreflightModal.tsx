// PreflightModal.tsx — 启动前缺配预检弹窗（§4），对照 app.js L991-1012
import { useEffect } from 'react'

interface PreflightModalProps {
  missingSkills: string[]
  hasConflict?: boolean
  onGoConfig: () => void
  onRunAnyway: () => void
  onDrop: () => void
  onClose: () => void
}

export function PreflightModal({ missingSkills, hasConflict, onGoConfig, onRunAnyway, onDrop, onClose }: PreflightModalProps) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  return (
    <div className="modal-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="pf-modal" role="dialog" aria-label="有技能缺少配置">
        <div className="pf-head">
          <span className="pf-ic">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
              <path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
              <path d="M12 9v4" />
              <path d="M12 17h.01" />
            </svg>
          </span>
          <div>
            <h2 className="pf-title">有技能还没配置</h2>
            <p className="pf-sub">下面的技能注入了本次任务，但必填的密钥/配置还没绑定，运行时它们可能失败。</p>
          </div>
        </div>
        <div className="pf-list">
          {missingSkills.map((name) => (
            <div key={name} className="pf-row">
              <span className="pf-name">{name}</span>
              <span className="cfg-badge cfg-badge--need">需配置</span>
            </div>
          ))}
        </div>
        <div className="pf-foot">
          <button className="btn-ghost" type="button" onClick={onDrop}>本次不注入它们</button>
          <span style={{ flex: 1 }} />
          {!hasConflict && (
            <button className="btn-ghost" type="button" onClick={onRunAnyway}>仍然运行</button>
          )}
          <button className="btn btn-primary" type="button" onClick={onGoConfig}>去配置</button>
        </div>
      </div>
    </div>
  )
}
