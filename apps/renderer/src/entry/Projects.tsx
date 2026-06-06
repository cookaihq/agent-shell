// Projects.tsx — 项目列表屏（对齐 open-design DesignsTab）
// 工具栏：左排序下拉 · 右搜索 + 选择 + 网格/看板切换；选择态批量删除；卡片 ⋯ 重命名/删除；看板按状态分列。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { ProjectDTO } from '../api/types'
import { ProjectCard } from './ProjectCard'
import {
  KANBAN_ORDER, SORTS, type SortKey, filterProjects, relativeTime, sortProjects, statusLabel,
} from './projectMeta'
import { IconCaret, IconCheck, IconClose, IconGrid, IconKanban, IconSearch, IconSort } from '../ui/icons'

const VIEW_KEY = 'agent-shell:projects:view'
type ViewMode = 'grid' | 'kanban'

interface ProjectsProps {
  projects: ProjectDTO[]
  onOpenProject: (id: string) => void
  onRenameProject: (id: string, name: string) => void
  onDeleteProjects: (ids: string[]) => void
}

export function Projects({ projects, onOpenProject, onRenameProject, onDeleteProjects }: ProjectsProps) {
  const [sort, setSort] = useState<SortKey>('created')
  const [sortOpen, setSortOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [view, setView] = useState<ViewMode>(() => (localStorage.getItem(VIEW_KEY) === 'kanban' ? 'kanban' : 'grid'))
  const [selectMode, setSelectMode] = useState(false)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [menuOpen, setMenuOpen] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<{ message: string; label: string; onOk: () => void } | null>(null)
  const [renameTarget, setRenameTarget] = useState<ProjectDTO | null>(null)
  const [renameInput, setRenameInput] = useState('')
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { localStorage.setItem(VIEW_KEY, view) }, [view])
  // 切到看板自动退出选择态（看板下无选择，对齐 open-design）
  useEffect(() => { if (view === 'kanban' && selectMode) { setSelectMode(false); setSelected(new Set()) } }, [view, selectMode])
  // 列表变动时丢掉已不存在的选中 id（删除后对账）
  useEffect(() => {
    setSelected((cur) => {
      const valid = new Set(projects.map((p) => p.id))
      let changed = false
      const next = new Set<string>()
      cur.forEach((id) => { if (valid.has(id)) next.add(id); else changed = true })
      return changed ? next : cur
    })
  }, [projects])
  // 点外部关闭排序下拉 / 卡片菜单
  useEffect(() => {
    if (!sortOpen && !menuOpen) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (sortOpen && !t.closest('.proj-sort')) setSortOpen(false)
      if (menuOpen && !t.closest('.proj-card-menu-anchor')) setMenuOpen(null)
    }
    window.addEventListener('mousedown', onDown)
    return () => window.removeEventListener('mousedown', onDown)
  }, [sortOpen, menuOpen])

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }

  const visible = useMemo(() => filterProjects(sortProjects(projects, sort), query), [projects, sort, query])
  const sortLabel = SORTS.find((s) => s.key === sort)?.label ?? SORTS[0].label

  const toggleSelected = (id: string) => setSelected((cur) => {
    const next = new Set(cur); next.has(id) ? next.delete(id) : next.add(id); return next
  })
  const exitSelect = () => { setSelectMode(false); setSelected(new Set()) }

  const askDeleteOne = (p: ProjectDTO) => {
    setMenuOpen(null)
    setConfirm({
      message: `确定删除「${p.name}」？此操作不可撤销（含磁盘文件）。`, label: '删除',
      onOk: () => { onDeleteProjects([p.id]); showToast('已删除项目') },
    })
  }
  const askDeleteSelected = () => {
    const ids = [...selected]
    if (!ids.length) return
    setConfirm({
      message: `确定删除选中的 ${ids.length} 个项目？此操作不可撤销（含磁盘文件）。`, label: '删除所选',
      onOk: () => { onDeleteProjects(ids); exitSelect(); showToast(`已删除 ${ids.length} 个项目`) },
    })
  }
  const openRename = (p: ProjectDTO) => { setMenuOpen(null); setRenameTarget(p); setRenameInput(p.name) }
  const commitRename = () => {
    if (!renameTarget) return
    const v = renameInput.trim()
    if (v && v !== renameTarget.name) onRenameProject(renameTarget.id, v)
    setRenameTarget(null)
  }

  return (
    <section className="section">
      <div className="section-head">
        <h1 className="section-title">项目</h1>
      </div>

      <div className="designs-toolbar">
        <div className="proj-sort">
          <button type="button" className="proj-sort-btn" aria-haspopup="menu" aria-expanded={sortOpen} onClick={() => setSortOpen((o) => !o)}>
            <IconSort size={14} /><span>{sortLabel}</span><IconCaret size={13} />
          </button>
          {sortOpen ? (
            <div className="proj-sort-menu" role="menu">
              {SORTS.map((s) => (
                <button key={s.key} type="button" role="menuitem" className={`menu-item${s.key === sort ? ' is-active' : ''}`} onClick={() => { setSort(s.key); setSortOpen(false) }}>
                  <span>{s.label}</span>{s.key === sort ? <span className="right">✓</span> : null}
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <div className="toolbar-right">
          <div className="toolbar-search">
            <span className="search-icon"><IconSearch size={13} /></span>
            <input placeholder="搜索…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          {view === 'grid' && selectMode ? (
            <div className="designs-select-bar" role="group">
              <span className="designs-select-count">已选 {selected.size} 个</span>
              <button type="button" className="designs-select-delete" disabled={selected.size === 0} onClick={askDeleteSelected}>删除所选</button>
              <button type="button" className="designs-select-cancel" onClick={exitSelect}>取消</button>
            </div>
          ) : view === 'grid' ? (
            <button type="button" className="designs-select-toggle" onClick={() => setSelectMode(true)}>
              <IconCheck size={13} /><span>选择</span>
            </button>
          ) : null}
          <div className="subtab-pill" role="group" aria-label="视图">
            <button type="button" className={view === 'grid' ? 'active' : ''} aria-pressed={view === 'grid'} title="网格" onClick={() => setView('grid')}><IconGrid size={14} /></button>
            <button type="button" className={view === 'kanban' ? 'active' : ''} aria-pressed={view === 'kanban'} title="看板" onClick={() => setView('kanban')}><IconKanban size={14} /></button>
          </div>
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="proj-empty">{query ? '没有匹配的项目' : '还没有项目'}</div>
      ) : view === 'grid' ? (
        <div className="proj-row">
          {visible.map((p) => (
            <ProjectCard
              key={p.id} project={p} onOpen={onOpenProject}
              selectMode={selectMode} selected={selected.has(p.id)} menuOpen={menuOpen === p.id}
              onToggleSelect={toggleSelected}
              onToggleMenu={(id) => setMenuOpen((cur) => (cur === id ? null : id))}
              onRename={openRename} onDelete={askDeleteOne}
            />
          ))}
        </div>
      ) : (
        <div className="proj-kanban">
          {KANBAN_ORDER.map((status) => {
            const items = visible.filter((p) => p.status === status)
            return (
              <div key={status} className="proj-kanban-col">
                <div className="proj-kanban-head"><span>{statusLabel(status)}</span><span className="proj-kanban-count">{items.length}</span></div>
                <div className="proj-kanban-list">
                  {items.length === 0 ? <div className="proj-kanban-empty">暂无</div> : items.map((p) => (
                    <div key={p.id} className="proj-kanban-card" onClick={() => onOpenProject(p.id)}>
                      <button type="button" className="pk-close" title="删除" onClick={(e) => { e.stopPropagation(); askDeleteOne(p) }}><IconClose size={13} /></button>
                      <div className="proj-kanban-card-name">{p.name}</div>
                      <div className="proj-kanban-card-meta">{relativeTime(p.createdAt)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}

      {renameTarget ? (
        <div className="dlg-backdrop" onClick={() => setRenameTarget(null)}>
          <form className="dlg" onClick={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); commitRename() }}>
            <h2>重命名项目</h2>
            <p>把「{renameTarget.name}」改名为：</p>
            <input
              autoFocus value={renameInput} onChange={(e) => setRenameInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); setRenameTarget(null) } }}
            />
            <div className="dlg-row">
              <button type="button" className="dlg-btn" onClick={() => setRenameTarget(null)}>取消</button>
              <button type="submit" className="dlg-btn primary" disabled={!renameInput.trim() || renameInput.trim() === renameTarget.name}>保存</button>
            </div>
          </form>
        </div>
      ) : null}

      {confirm ? (
        <div className="dlg-backdrop" onClick={() => setConfirm(null)}>
          <div className="dlg" role="alertdialog" aria-modal="true" onClick={(e) => e.stopPropagation()}>
            <h2>删除项目</h2>
            <p>{confirm.message}</p>
            <div className="dlg-row">
              <button type="button" className="dlg-btn" onClick={() => setConfirm(null)}>取消</button>
              <button type="button" className="dlg-btn danger" autoFocus onClick={() => { const ok = confirm.onOk; setConfirm(null); ok() }}>{confirm.label}</button>
            </div>
          </div>
        </div>
      ) : null}

      {toast ? <div className="proj-toast show">{toast}</div> : null}
    </section>
  )
}
