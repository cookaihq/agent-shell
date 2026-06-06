// SkillModal.tsx — 注入技能模态（真实技能库，与技能子页同源），对照 app.js L774-813
import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { LibrarySkill } from '../api/types'
import { IconClose } from '../ui/icons'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

interface SkillModalProps {
  initialSelected: string[]
  onClose: () => void
  onDone: (selected: string[]) => void
}

export function SkillModal({ initialSelected, onClose, onDone }: SkillModalProps) {
  const [q, setQ] = useState('')
  const [sel, setSel] = useState<Set<string>>(() => new Set(initialSelected))
  const [skills, setSkills] = useState<LibrarySkill[]>([])

  useEffect(() => {
    api.listSkillLibrary().then(r => setSkills(r.skills)).catch(() => setSkills([]))
  }, [])

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])

  const rows = skills.filter((s) => {
    const k = q.trim().toLowerCase()
    return !k || s.name.toLowerCase().includes(k) || s.desc.toLowerCase().includes(k)
  })

  const toggle = (effectiveName: string) => setSel((prev) => {
    const next = new Set(prev)
    next.has(effectiveName) ? next.delete(effectiveName) : next.add(effectiveName)
    return next
  })

  return (
    <div className="modal-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="skill-modal" role="dialog" aria-label="注入技能">
        <div className="sm-head">
          <h2 className="sm-title">注入技能</h2>
          <IconButton variant="modal-close" title="关闭 (Esc)" onClick={onClose}><IconClose size={16} /></IconButton>
        </div>
        <p className="sm-sub">选择要注入到本次任务上下文的技能。</p>
        <div className="sm-search">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M21 21l-4-4" />
          </svg>
          <input
            placeholder="搜索技能…"
            autoComplete="off"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            autoFocus
          />
        </div>
        <div className="sm-list">
          {rows.length ? rows.map((s) => (
            <button
              key={s.effectiveName}
              className={`si-row${sel.has(s.effectiveName) ? ' on' : ''}`}
              type="button"
              onClick={() => toggle(s.effectiveName)}
            >
              <span className="si-main">
                <span className="si-name">
                  {s.name}
                  {s.globalIn.length > 0 && (
                    <span
                      className="si-shadow"
                      title={`全局 ${s.globalIn.map(e => e === 'claude' ? 'Claude' : 'Codex').join('·')} 已有同名，会覆盖注入的这个（个人级 > 项目级），注入将不生效`}
                    >
                      ⚠ {s.globalIn.map(e => e === 'claude' ? 'Claude' : 'Codex').join('·')} 全局
                    </span>
                  )}
                </span>
                <span className="si-desc">{s.desc}</span>
              </span>
              <span className="si-check">✓</span>
            </button>
          )) : <div className="sm-empty">没有匹配的技能</div>}
        </div>
        <div className="sm-foot">
          <span className="sm-count">{sel.size ? `已选 ${sel.size} 个` : '未选择'}</span>
          <span className="sm-sp" />
          <Button variant="primary" onClick={() => onDone([...sel])}>完成</Button>
        </div>
      </div>
    </div>
  )
}
