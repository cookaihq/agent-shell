import { useEffect, useState } from 'react'
import type React from 'react'
import { IconClose } from '../ui/icons'
import { IconButton } from '../ui/IconButton'
import { ExecMode } from './ExecMode'
import { SystemSettings } from './SystemSettings'
import type { SettingsSection } from './SettingsContext'

const NAV: { k: SettingsSection; t: string; icon: React.ReactNode }[] = [
  { k: 'exec', t: '执行模式', icon: <path d="M16 18l6-6-6-6M8 6l-6 6 6 6" /> },
  { k: 'system', t: '系统设置', icon: <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></> },
]

const NavIcon = ({ p }: { p: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width={16} height={16} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">{p}</svg>
)

interface SettingsProps { section: SettingsSection; onClose: () => void }

export function Settings({ section, onClose }: SettingsProps) {
  const [active, setActive] = useState<SettingsSection>(section)
  useEffect(() => setActive(section), [section])
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', h)
    return () => document.removeEventListener('keydown', h)
  }, [onClose])
  return (
    <div className="modal-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="modal">
        <IconButton variant="modal-close" title="关闭 (Esc)" onClick={onClose}><IconClose size={16} /></IconButton>
        <div className="set-side">
          <h3>设置</h3>
          <div className="set-nav">
            {NAV.map((n) => (
              <button key={n.k} className={`set-nav-item${active === n.k ? ' is-active' : ''}`} onClick={() => setActive(n.k)}>
                <NavIcon p={n.icon} />{n.t}
              </button>
            ))}
          </div>
        </div>
        <div className="set-main">
          <div className="set-main-inner">
            {active === 'exec' && <ExecMode />}
            {active === 'system' && <SystemSettings />}
          </div>
        </div>
      </div>
    </div>
  )
}
