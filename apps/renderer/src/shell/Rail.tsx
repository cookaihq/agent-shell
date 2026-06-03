// Rail.tsx — nav.rail，1:1 对照 app.js renderRail L43-55
import type React from 'react'

interface RailProps {
  active: 'home' | 'projects'
  onNewProject: () => void
  onHome: () => void
  onProjects: () => void
}

const ICON = {
  plus: <path d="M12 5v14M5 12h14" />,
  home: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .8-1 1.7M12 17h.01" strokeLinecap="round" /></>,
}

const RailIcon = ({ p }: { p: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">{p}</svg>
)

export function Rail({ active, onNewProject, onHome, onProjects }: RailProps) {
  return (
    <nav className="rail" id="rail">
      <div className="rail-group">
        <a className="rail-logo" title="Agent Shell" onClick={(e) => { e.preventDefault(); onHome() }}>
          <svg viewBox="0 0 32 32" fill="none">
            <rect width="32" height="32" rx="8" fill="var(--accent)" />
            <path d="M9 11l4 5-4 5" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 22h7" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" />
          </svg>
        </a>
        <div className="rail-div" />
        <a className="rail-btn" data-tip="新建项目" aria-label="新建项目" onClick={(e) => { e.preventDefault(); onNewProject() }}><RailIcon p={ICON.plus} /></a>
        <a className={`rail-btn${active === 'home' ? ' is-active' : ''}`} data-tip="工作区" aria-label="工作区" onClick={(e) => { e.preventDefault(); onHome() }}><RailIcon p={ICON.home} /></a>
        <a className={`rail-btn${active === 'projects' ? ' is-active' : ''}`} data-tip="项目" aria-label="项目" onClick={(e) => { e.preventDefault(); onProjects() }}><RailIcon p={ICON.folder} /></a>
      </div>
      <div className="rail-foot">
        <div className="rail-div" />
        <a className="rail-btn" data-tip="帮助" aria-label="帮助" onClick={(e) => e.preventDefault()}><RailIcon p={ICON.help} /></a>
      </div>
    </nav>
  )
}
