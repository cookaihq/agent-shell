// ProjectCard.tsx — 项目卡（home/projects 共用），对照 home.html L47-50
import type { ProjectDTO } from '../api/types'
import { glyph, relativeTime, statusClass, statusLabel } from './projectMeta'

interface ProjectCardProps { project: ProjectDTO; onOpen: (id: string) => void }

export function ProjectCard({ project, onOpen }: ProjectCardProps) {
  return (
    <a className="proj-card" onClick={(e) => { e.preventDefault(); onOpen(project.id) }}>
      <div className={`proj-thumb${project.engine === 'codex' ? ' codex' : ''}`}>
        <span className="glyph">{glyph(project.name)}</span>
      </div>
      <div className="proj-meta">
        <div className="proj-name">{project.name}</div>
        <div className="proj-time">
          {relativeTime(project.createdAt)} <span className="proj-sep">·</span>{' '}
          <span className={`proj-status ${statusClass(project.status)}`}>
            <span className="sdot" />{statusLabel(project.status)}
          </span>
        </div>
      </div>
    </a>
  )
}
