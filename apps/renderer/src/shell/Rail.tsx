// Rail.tsx — nav.rail，1:1 对照 app.js renderRail L43-55
import type React from 'react'

interface RailProps {
  active: 'home' | 'projects' | 'automations' | 'integrations'
  onNewProject: () => void
  onHome: () => void
  onProjects: () => void
  onAutomations: () => void
  onIntegrations: () => void
}

const ICON = {
  plus: <path d="M12 5v14M5 12h14" />,
  home: <><path d="M3 11l9-8 9 8" /><path d="M5 10v10h14V10" /></>,
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />,
  kanban: <><rect x="3" y="4" width="6" height="16" rx="1" /><rect x="10" y="4" width="6" height="10" rx="1" /><rect x="17" y="4" width="4" height="7" rx="1" /></>,
  link: <><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 0 0-7-7l-1.5 1.5" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 0 0 7 7l1.5-1.5" /></>,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 .8-1 1.7M12 17h.01" strokeLinecap="round" /></>,
}

const RailIcon = ({ p }: { p: React.ReactNode }) => (
  <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">{p}</svg>
)

export function Rail({ active, onNewProject, onHome, onProjects, onAutomations, onIntegrations }: RailProps) {
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
        <a className={`rail-btn${active === 'automations' ? ' is-active' : ''}`} data-tip="任务自动化" aria-label="任务自动化" onClick={(e) => { e.preventDefault(); onAutomations() }}><RailIcon p={ICON.kanban} /></a>
        <a className={`rail-btn${active === 'integrations' ? ' is-active' : ''}`} data-tip="集成" aria-label="集成" onClick={(e) => { e.preventDefault(); onIntegrations() }}><RailIcon p={ICON.link} /></a>
      </div>
      <div className="rail-foot">
        <div className="rail-div" />
        <a className="rail-btn" data-tip="帮助" aria-label="帮助" onClick={(e) => e.preventDefault()}><RailIcon p={ICON.help} /></a>
      </div>
    </nav>
  )
}
