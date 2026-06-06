// ProjectCard.tsx — 项目卡（home/projects 共用），对照 home.html L47-50
// 选择态勾选框 + ⋯ 菜单为可选能力：Home 仅传 project/onOpen → 维持纯卡片；Projects 传齐 → 启用选择/菜单。
import type { ProjectDTO } from '../api/types'
import { glyph, relativeTime, statusClass, statusLabel } from './projectMeta'
import { IconCheck, IconClose, IconMore, IconPencil } from '../ui/icons'

interface ProjectCardProps {
  project: ProjectDTO
  onOpen: (id: string) => void
  selectMode?: boolean
  selected?: boolean
  menuOpen?: boolean
  onToggleSelect?: (id: string) => void
  onToggleMenu?: (id: string) => void
  onRename?: (project: ProjectDTO) => void
  onDelete?: (project: ProjectDTO) => void
}

export function ProjectCard({
  project, onOpen, selectMode = false, selected = false, menuOpen = false,
  onToggleSelect, onToggleMenu, onRename, onDelete,
}: ProjectCardProps) {
  const showMenu = !selectMode && !!onToggleMenu
  return (
    <a
      className={`proj-card${selected ? ' is-selected' : ''}`}
      onClick={(e) => { e.preventDefault(); selectMode ? onToggleSelect?.(project.id) : onOpen(project.id) }}
    >
      {selectMode ? (
        <span className="proj-card-checkbox">{selected ? <IconCheck size={12} /> : null}</span>
      ) : showMenu ? (
        <div className="proj-card-menu-anchor">
          <button
            type="button" className="proj-card-more" aria-haspopup="menu" aria-expanded={menuOpen}
            onClick={(e) => { e.preventDefault(); e.stopPropagation(); onToggleMenu?.(project.id) }}
          >
            <IconMore size={16} />
          </button>
          {menuOpen ? (
            <div className="proj-menu" role="menu" onClick={(e) => e.stopPropagation()}>
              <button type="button" role="menuitem" className="menu-item" onClick={(e) => { e.preventDefault(); onRename?.(project) }}>
                <IconPencil size={12} /><span>重命名</span>
              </button>
              <button type="button" role="menuitem" className="menu-item danger" onClick={(e) => { e.preventDefault(); onDelete?.(project) }}>
                <IconClose size={12} /><span>删除</span>
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
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
