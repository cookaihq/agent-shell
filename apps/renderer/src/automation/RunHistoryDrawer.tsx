// 运行历史抽屉：列某条自动化每次跑（时间 + 触发方式 + 状态 + 耗时 + 打开产出会话）。对齐原型 tasks.html #histModal。
import { useEffect, useState } from 'react'
import type { AutomationDTO, AutomationRunDTO, AutomationRunStatus } from '../api/types'
import { api } from '../api/client'

const STATUS_LABEL: Record<AutomationRunStatus, { text: string; cls: string }> = {
  queued: { text: '排队中', cls: '' },
  running: { text: '运行中', cls: 'run' },
  succeeded: { text: '已完成', cls: '' },
  failed: { text: '失败', cls: 'fail' },
  'needs-review': { text: '待复核', cls: 'review' },
  canceled: { text: '已取消', cls: 'abort' },
}

function stamp(ms: number): string {
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}
function duration(run: AutomationRunDTO): string {
  if (!run.completedAt) return '进行中'
  const s = Math.max(0, Math.round((run.completedAt - run.startedAt) / 1000))
  return `耗时 ${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

export interface RunHistoryDrawerProps {
  automation: AutomationDTO
  onClose: () => void
  onOpenSession: (projectId: string, sessionId: string) => void
}

export function RunHistoryDrawer({ automation, onClose, onOpenSession }: RunHistoryDrawerProps) {
  const [runs, setRuns] = useState<AutomationRunDTO[] | null>(null)
  useEffect(() => {
    let alive = true
    void api.listAutomationRuns(automation.id).then((r) => { if (alive) setRuns(r.runs) }).catch(() => { if (alive) setRuns([]) })
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => { alive = false; document.removeEventListener('keydown', onKey) }
  }, [automation.id, onClose])

  return (
    <div className="automation-modal-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="automation-modal" style={{ width: 'min(520px,100%)' }}>
        <header className="automation-modal__head" style={{ paddingBottom: 14, borderBottom: '1px solid var(--border-soft)' }}>
          <span className="automation-modal__title-input" style={{ fontFamily: 'var(--serif)' }}>运行历史 · {automation.name}</span>
          <div className="automation-modal__head-actions">
            <button type="button" className="automation-modal__close" onClick={onClose} aria-label="关闭">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </header>
        <div className="automation-modal__body" style={{ padding: '8px 10px 14px' }}>
          <div className="hist-scroll" style={{ maxHeight: 300 }}>
            {runs === null && <div className="auto-pop__label" style={{ padding: '10px 4px' }}>加载中…</div>}
            {runs !== null && runs.length === 0 && <div className="auto-pop__label" style={{ padding: '10px 4px' }}>还没有运行记录。</div>}
            {runs?.map((run) => {
              const st = STATUS_LABEL[run.status]
              return (
                <div className="hist-item" key={run.id}>
                  <span className={`hi-dot ${automation.engine}`} />
                  <span className="hi-body">
                    <span className="hi-title">{stamp(run.startedAt)} · {run.trigger === 'scheduled' ? '定时' : '手动'}</span>
                    <span className="hi-sub">
                      {duration(run)}
                      {run.error ? ` · ${run.error}` : run.summary ? ` · ${run.summary}` : ''}
                      {run.sessionId ? <> · <a onClick={() => onOpenSession(run.projectId, run.sessionId!)} style={{ cursor: 'pointer', color: 'var(--accent)' }}>打开会话</a></> : null}
                    </span>
                  </span>
                  <span className={`hi-when ${st.cls}`}>{st.text}</span>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
