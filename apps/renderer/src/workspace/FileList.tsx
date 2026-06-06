/**
 * FileList.tsx — 文件浏览器右侧「文件列表」面板（Issue 16 重构）
 *
 * 视图模式（参考 macOS Finder）：列表(list) / 图标网格(icons) / 画廊(gallery)。
 *   - list   ：表头 + 行（grid 四列），按子文件夹 + 类型分组；名称前缩略图（图片显真实小图）。
 *   - icons  ：平铺网格（不分组），缩略图渲染真实内容（图片→<img>，HTML→缩放 iframe 懒加载，其余→图标）；
 *              右下角尺寸滑杆调图标大小（全局持久化）。
 *   - gallery：顶部大预览（嵌入 Preview 渲染真实内容）+ 底部缩略条。
 *   视图与图标尺寸都全局持久化到 localStorage（所有项目共用）。
 *
 * 虚拟化（@tanstack/react-virtual）：列表与网格只渲染滚动到可见区附近的项，大目录（daemon 上限 2000 节点）
 *   也不会一次性铺出几百上千 DOM。两者都以 .fb-main 为滚动容器，靠 scrollMargin 抵消上方 bar/表头的高度。
 */

import { useState, useRef, useMemo, useLayoutEffect, useEffect } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { api } from '../api/client'
import type { FileNode } from '../api/types'
import { RenameInput, type RenameCtx } from './RenameInput'
import { Preview, IMAGE_EXT } from './Preview'

function isImagePath(name: string): boolean {
  return IMAGE_EXT.has(name.toLowerCase().split('.').pop() ?? '')
}
function isHtmlPath(name: string): boolean {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  return ext === 'html' || ext === 'htm'
}

// 文件时间格式化：epoch ms → 'YYYY-MM-DD HH:mm'（本地时区）；空/0/无值 → '—'（Issue 10 列表视图时间列）
function fmtTime(ms?: number): string {
  if (!ms) return '—'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// ── 视图模式：全局持久化（localStorage，所有项目共用） ───────────────────────
type ViewMode = 'list' | 'icons' | 'gallery'
const VIEW_KEY = 'agent-shell:file-view-mode'

function loadViewMode(): ViewMode {
  try {
    const v = localStorage.getItem(VIEW_KEY)
    return v === 'icons' || v === 'gallery' || v === 'list' ? v : 'list'
  } catch {
    return 'list'
  }
}
function saveViewMode(m: ViewMode) {
  try { localStorage.setItem(VIEW_KEY, m) } catch { /* best-effort */ }
}

// ── 图标网格尺寸：全局持久化 ────────────────────────────────────────────────
const GRID_KEY = 'agent-shell:file-grid-size'
const GRID_MIN = 72
const GRID_MAX = 200
const GRID_DEFAULT = 108
const GRID_GAP = 14          // 网格列/行间距
const CELL_EXTRA = 60        // 单格在缩略图高度之外的额外高度（名称两行 + 间距）
const HTML_THUMB_MIN = 72    // HTML 缩略图渲染门槛：小于此尺寸退回图标

function loadGridSize(): number {
  try {
    const n = parseInt(localStorage.getItem(GRID_KEY) ?? '', 10)
    return Number.isFinite(n) ? Math.min(GRID_MAX, Math.max(GRID_MIN, n)) : GRID_DEFAULT
  } catch {
    return GRID_DEFAULT
  }
}
function saveGridSize(n: number) {
  try { localStorage.setItem(GRID_KEY, String(n)) } catch { /* best-effort */ }
}

// ── 文件类型 → 可读标签 + 短标识 ────────────────────────────────────────────
function fileTypeLabel(name: string): { type: string; tag: string; cssClass: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'html' || ext === 'htm') return { type: 'HTML 页面', tag: '</>', cssClass: '' }
  if (ext === 'css') return { type: '样式表', tag: '#', cssClass: 'css' }
  if (ext === 'md') return { type: 'Markdown', tag: 'M↓', cssClass: '' }
  if (ext === 'json') return { type: 'JSON', tag: '{ }', cssClass: '' }
  if (ext === 'ts' || ext === 'tsx') return { type: 'TypeScript', tag: 'TS', cssClass: '' }
  if (ext === 'js' || ext === 'jsx') return { type: 'JavaScript', tag: 'JS', cssClass: '' }
  return { type: ext ? ext.toUpperCase() : '文件', tag: '·', cssClass: '' }
}

// 定位选中目录的直接子节点（''=根 → 顶层 nodes）。
function childrenOf(nodes: FileNode[], dir: string): FileNode[] {
  if (!dir) return nodes
  let cur = nodes
  for (const seg of dir.split('/')) {
    const found = cur.find((n) => n.type === 'dir' && n.name === seg)
    if (!found) return []
    cur = found.children ?? []
  }
  return cur
}

// 递归收集某子树下的所有文件（用于子文件夹分组 / 网格平铺）。
function collectFiles(nodes: FileNode[]): FileNode[] {
  const out: FileNode[] = []
  for (const n of nodes) {
    if (n.type === 'file') out.push(n)
    else if (n.children) out.push(...collectFiles(n.children))
  }
  return out
}

// 按文件类型分组（次级分组）。
function groupByType(files: FileNode[]): Map<string, FileNode[]> {
  const map = new Map<string, FileNode[]>()
  for (const f of files) {
    const { type } = fileTypeLabel(f.name)
    if (!map.has(type)) map.set(type, [])
    map.get(type)!.push(f)
  }
  return map
}

// 计算「内层容器相对滚动容器的偏移」——虚拟列表用它抵消上方 bar/表头的高度。
// 用 getBoundingClientRect（而非 offsetTop）避免依赖 .fb-main 定位（滑杆需要 .fb-main 不定位）。
function offsetWithin(scrollEl: HTMLElement | null, inner: HTMLElement | null): number {
  if (!scrollEl || !inner) return 0
  return inner.getBoundingClientRect().top - scrollEl.getBoundingClientRect().top + scrollEl.scrollTop
}

// ── 文件缩略图：图片→真实 <img>，HTML（尺寸够大）→缩放 iframe 懒加载，其余→类型图标 ──
function HtmlThumb({ projectId, path }: { projectId: string; path: string }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const [visible, setVisible] = useState(false)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el || typeof IntersectionObserver === 'undefined') { setVisible(true); return }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setVisible(true); io.disconnect() }
    }, { rootMargin: '300px' })
    io.observe(el)
    return () => io.disconnect()
  }, [])
  return (
    <span ref={ref} className="fb-thumb-html">
      {visible
        ? <iframe className="fb-thumb-htmlframe" src={api.rawUrl(projectId, path)} sandbox="allow-same-origin" tabIndex={-1} aria-hidden title={path} />
        : <span className="fb-icon">{'</>'}</span>}
    </span>
  )
}

function FileThumb({ file, projectId, size }: { file: FileNode; projectId: string; size: number }) {
  const [imgFailed, setImgFailed] = useState(false)
  if (isImagePath(file.name) && !imgFailed) {
    return <img className="fb-thumb-img" src={api.rawUrl(projectId, file.path)} alt={file.name} loading="lazy" onError={() => setImgFailed(true)} />
  }
  if (isHtmlPath(file.name) && size >= HTML_THUMB_MIN) {
    return <HtmlThumb projectId={projectId} path={file.path} />
  }
  const { tag, cssClass } = fileTypeLabel(file.name)
  return <span className={`fb-icon${cssClass ? ' ' + cssClass : ''}`}>{tag}</span>
}

// ── 列表视图：分组结构扁平化为 item 数组，用 measureElement 虚拟化（组头/行不等高） ──
type ListItem =
  | { kind: 'folderh'; key: string; label: string; count: number; isDir: boolean }
  | { kind: 'grouph'; key: string; label: string; count: number; nested: boolean }
  | { kind: 'row'; key: string; file: FileNode; nested: boolean }
  | { kind: 'empty'; key: string }

function flattenList(children: FileNode[]): ListItem[] {
  const subDirs = children.filter((n) => n.type === 'dir')
  const directFiles = children.filter((n) => n.type === 'file')
  const hasSubdirs = subDirs.length > 0
  const items: ListItem[] = []
  const pushGroups = (files: FileNode[], nested: boolean) => {
    for (const [type, fs] of groupByType(files)) {
      items.push({ kind: 'grouph', key: `gh:${nested ? 1 : 0}:${type}:${fs[0]?.path ?? type}`, label: type, count: fs.length, nested })
      for (const f of fs) items.push({ kind: 'row', key: f.path, file: f, nested })
    }
  }
  if (hasSubdirs) {
    if (directFiles.length) {
      items.push({ kind: 'folderh', key: 'fh:current', label: '（当前目录）', count: directFiles.length, isDir: false })
      pushGroups(directFiles, true)
    }
    for (const dir of subDirs) {
      const files = collectFiles(dir.children ?? [])
      items.push({ kind: 'folderh', key: `fh:${dir.path}`, label: dir.name, count: files.length, isDir: true })
      if (files.length) pushGroups(files, true)
      else items.push({ kind: 'empty', key: `empty:${dir.path}` })
    }
  } else {
    pushGroups(directFiles, false)
  }
  return items
}

function ListItemView({ it, onOpen, projectId, onItemContext, rename, selected, onItemClick, onItemDragStart }: { it: ListItem; onOpen: (p: string) => void; projectId: string; onItemContext: (file: FileNode, e: React.MouseEvent) => void; rename?: RenameCtx; selected: Set<string>; onItemClick: (file: FileNode, e: React.MouseEvent) => void; onItemDragStart: (file: FileNode, e: React.DragEvent) => void }) {
  if (it.kind === 'folderh') {
    return (
      <div className="fb-folder-h fb-folder-h--virt">
        {it.isDir && (
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
        )}
        {it.label} <span className="cnt">{it.count}</span>
      </div>
    )
  }
  if (it.kind === 'grouph') {
    return <div className={`fb-group${it.nested ? ' is-nested' : ''}`}>{it.label} <span className="cnt">{it.count}</span></div>
  }
  if (it.kind === 'empty') {
    return <div className="fb-folder-empty">（空文件夹）</div>
  }
  // row（单击选中 / 双击打开 / 右键命中；多选高亮 is-selected）
  const { type } = fileTypeLabel(it.file.name)
  return (
    <div
      className={`fb-row${it.nested ? ' is-nested' : ''}${selected.has(it.file.path) ? ' is-selected' : ''}`}
      draggable={rename?.path !== it.file.path}
      onClick={(e) => onItemClick(it.file, e)}
      onDoubleClick={() => onOpen(it.file.path)}
      onContextMenu={(e) => onItemContext(it.file, e)}
      onDragStart={(e) => onItemDragStart(it.file, e)}
      title={it.file.name}
    >
      <span className="fb-col-name">
        <span className="fb-rowthumb"><FileThumb file={it.file} projectId={projectId} size={34} /></span>
        {rename?.path === it.file.path ? (
          <RenameInput name={it.file.name} onSubmit={(n) => rename.submit(it.file.path, n)} onCancel={rename.cancel} />
        ) : (
          <span className="fb-meta"><b>{it.file.name}</b><i /></span>
        )}
      </span>
      <span className="fb-col-type">{type}</span>
      <span className="fb-col-time">{fmtTime(it.file.mtimeMs)}</span>
      <span className="fb-col-ctime">{fmtTime(it.file.birthtimeMs)}</span>
    </div>
  )
}

function ListView({ children, onOpen, projectId, scrollRef, onItemContext, rename, selected, onItemClick, onItemDragStart }: { children: FileNode[]; onOpen: (p: string) => void; projectId: string; scrollRef: React.RefObject<HTMLElement>; onItemContext: (file: FileNode, e: React.MouseEvent) => void; rename?: RenameCtx; selected: Set<string>; onItemClick: (file: FileNode, e: React.MouseEvent) => void; onItemDragStart: (file: FileNode, e: React.DragEvent) => void }) {
  const items = useMemo(() => flattenList(children), [children])
  const innerRef = useRef<HTMLDivElement>(null)
  const [scrollMargin, setScrollMargin] = useState(0)

  useLayoutEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const measure = () => setScrollMargin(offsetWithin(sc, innerRef.current))
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(sc)
    return () => ro.disconnect()
  }, [scrollRef, items.length])

  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 44,
    overscan: 12,
    scrollMargin,
    getItemKey: (i) => items[i].key,
  })

  return (
    <div ref={innerRef} className="fb-body is-list" style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((vi) => (
        <div
          key={items[vi.index].key}
          data-index={vi.index}
          ref={virtualizer.measureElement}
          style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${vi.start - scrollMargin}px)` }}
        >
          <ListItemView it={items[vi.index]} onOpen={onOpen} projectId={projectId} onItemContext={onItemContext} rename={rename} selected={selected} onItemClick={onItemClick} onItemDragStart={onItemDragStart} />
        </div>
      ))}
    </div>
  )
}

// ── 图标网格视图：平铺（不分组）+ 虚拟化（lanes 多列）；尺寸由滑杆驱动 ──────────
function GridCell({ file, projectId, size, onOpen, onItemContext, rename, selected, onItemClick, onItemDragStart }: { file: FileNode; projectId: string; size: number; onOpen: (p: string) => void; onItemContext: (file: FileNode, e: React.MouseEvent) => void; rename?: RenameCtx; selected: boolean; onItemClick: (file: FileNode, e: React.MouseEvent) => void; onItemDragStart: (file: FileNode, e: React.DragEvent) => void }) {
  return (
    <button type="button" className={`fb-cell${selected ? ' is-selected' : ''}`} draggable={rename?.path !== file.path} onClick={(e) => onItemClick(file, e)} onDoubleClick={() => onOpen(file.path)} onContextMenu={(e) => onItemContext(file, e)} onDragStart={(e) => onItemDragStart(file, e)} title={file.name}>
      <span className="fb-cell-thumb"><FileThumb file={file} projectId={projectId} size={size} /></span>
      {rename?.path === file.path ? (
        <RenameInput name={file.name} onSubmit={(n) => rename.submit(file.path, n)} onCancel={rename.cancel} />
      ) : (
        <span className="fb-cell-name">{file.name}</span>
      )}
    </button>
  )
}

function IconGridView({ files, onOpen, projectId, size, scrollRef, onItemContext, rename, selected, onItemClick, onItemDragStart }: { files: FileNode[]; onOpen: (p: string) => void; projectId: string; size: number; scrollRef: React.RefObject<HTMLElement>; onItemContext: (file: FileNode, e: React.MouseEvent) => void; rename?: RenameCtx; selected: Set<string>; onItemClick: (file: FileNode, e: React.MouseEvent) => void; onItemDragStart: (file: FileNode, e: React.DragEvent) => void }) {
  const innerRef = useRef<HTMLDivElement>(null)
  const [cols, setCols] = useState(1)
  const [scrollMargin, setScrollMargin] = useState(0)

  useLayoutEffect(() => {
    const sc = scrollRef.current
    if (!sc) return
    const measure = () => {
      const w = innerRef.current?.clientWidth ?? 0
      setCols(Math.max(1, Math.floor((w + GRID_GAP) / (size + GRID_GAP))))
      setScrollMargin(offsetWithin(sc, innerRef.current))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(sc)
    if (innerRef.current) ro.observe(innerRef.current)
    return () => ro.disconnect()
  }, [scrollRef, size, files.length])

  const rowHeight = size + CELL_EXTRA
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => rowHeight,
    overscan: cols * 2,
    lanes: cols,
    scrollMargin,
    getItemKey: (i) => files[i].path,
  })

  // 网格格子不挂 measureElement、estimateSize 又非 getMeasurements 的记忆依赖：滑杆改 size 后 rowHeight 变了，
  // 若 cols 没跨边界（约 80% 的步）虚拟器不会自动重算，行距会停留在旧 rowHeight 导致逐行重叠 → 显式 measure() 强制重排。
  useLayoutEffect(() => { virtualizer.measure() }, [rowHeight, virtualizer])

  const style = { '--fb-grid-size': `${size}px`, '--fb-grid-scale': String(size / 1024) } as React.CSSProperties

  if (!files.length) return <div className="fb-folder-empty">（当前目录没有文件）</div>

  return (
    <div ref={innerRef} className="fb-grid" style={{ ...style, height: virtualizer.getTotalSize(), position: 'relative' }}>
      {virtualizer.getVirtualItems().map((vi) => (
        <div
          key={files[vi.index].path}
          className="fb-cell-slot"
          style={{ position: 'absolute', top: 0, left: `${(vi.lane * 100) / cols}%`, width: `${100 / cols}%`, transform: `translateY(${vi.start - scrollMargin}px)`, height: rowHeight }}
        >
          <GridCell file={files[vi.index]} projectId={projectId} size={size} onOpen={onOpen} onItemContext={onItemContext} rename={rename} selected={selected.has(files[vi.index].path)} onItemClick={onItemClick} onItemDragStart={onItemDragStart} />
        </div>
      ))}
    </div>
  )
}

// 右下角图标尺寸滑杆（仅网格视图；锚定 .fw-body 右下角，逃出 .fb-main 滚动区）。
function SizeSlider({ value, onChange }: { value: number; onChange: (n: number) => void }) {
  return (
    <div className="fb-sizebar" title="调整图标大小">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="6" y="6" width="12" height="12" rx="2" /></svg>
      <input
        type="range"
        className="fb-sizerange"
        min={GRID_MIN}
        max={GRID_MAX}
        step={4}
        value={value}
        aria-label="图标大小"
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <svg width="17" height="17" viewBox="0 0 24 24" fill="currentColor" aria-hidden><rect x="4" y="4" width="16" height="16" rx="3" /></svg>
    </div>
  )
}

// ── 视图切换分段控件（参考 macOS Finder 的图标/列表/画廊三视图） ──────────────
const VIEW_ICONS: Record<ViewMode, JSX.Element> = {
  icons: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" />
    </svg>
  ),
  list: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="20" y2="6" /><line x1="8" y1="12" x2="20" y2="12" /><line x1="8" y1="18" x2="20" y2="18" />
      <line x1="4" y1="6" x2="4.01" y2="6" /><line x1="4" y1="12" x2="4.01" y2="12" /><line x1="4" y1="18" x2="4.01" y2="18" />
    </svg>
  ),
  gallery: (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="4" width="18" height="11" rx="1.5" />
      <line x1="6" y1="19" x2="6.01" y2="19" /><line x1="12" y1="19" x2="12.01" y2="19" /><line x1="18" y1="19" x2="18.01" y2="19" />
    </svg>
  ),
}
const VIEW_TITLES: Record<ViewMode, string> = { icons: '图标视图', list: '列表视图', gallery: '画廊视图' }

function ViewSeg({ mode, onChange }: { mode: ViewMode; onChange: (m: ViewMode) => void }) {
  return (
    <div className="fb-viewseg" role="group" aria-label="视图模式">
      {(['icons', 'list', 'gallery'] as ViewMode[]).map((m) => (
        <button
          key={m}
          type="button"
          className={`fb-vbtn${mode === m ? ' is-active' : ''}`}
          data-fbview={m}
          title={VIEW_TITLES[m]}
          aria-label={VIEW_TITLES[m]}
          aria-pressed={mode === m}
          onClick={() => onChange(m)}
        >
          {VIEW_ICONS[m]}
        </button>
      ))}
    </div>
  )
}

// 画廊缩略条单项：复用 FileThumb（图片真实小图、其余图标）；button 承载聚焦 / 打开。
function GalThumb({ file, active, projectId, onFocus, onOpen, onItemContext, rename, onItemDragStart }: {
  file: FileNode; active: boolean; projectId: string; onFocus: () => void; onOpen: () => void; onItemContext: (file: FileNode, e: React.MouseEvent) => void; rename?: RenameCtx; onItemDragStart: (file: FileNode, e: React.DragEvent) => void
}) {
  return (
    <button
      type="button"
      className={`fb-gal-thumb${active ? ' is-active' : ''}`}
      title={file.name}
      draggable={rename?.path !== file.path}
      onClick={onFocus}
      onDoubleClick={onOpen}
      onContextMenu={(e) => onItemContext(file, e)}
      onDragStart={(e) => onItemDragStart(file, e)}
    >
      <FileThumb file={file} projectId={projectId} size={40} />
      {rename?.path === file.path ? (
        <RenameInput name={file.name} onSubmit={(n) => rename.submit(file.path, n)} onCancel={rename.cancel} />
      ) : (
        <span className="fb-gal-tname">{file.name}</span>
      )}
    </button>
  )
}

// 画廊缩略条：横向虚拟化（与网格吃同一份 collectFiles 列表，大目录同样需要）。
const STRIP_PITCH = 92  // 缩略宽 84 + 间距 8
const STRIP_H = 96
function GalleryStrip({ files, focusedPath, projectId, onFocus, onOpen, onItemContext, rename, onItemDragStart }: {
  files: FileNode[]; focusedPath: string; projectId: string; onFocus: (p: string) => void; onOpen: (p: string) => void; onItemContext: (file: FileNode, e: React.MouseEvent) => void; rename?: RenameCtx; onItemDragStart: (file: FileNode, e: React.DragEvent) => void
}) {
  const stripRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({
    count: files.length,
    getScrollElement: () => stripRef.current,
    estimateSize: () => STRIP_PITCH,
    horizontal: true,
    overscan: 8,
    getItemKey: (i) => files[i].path,
  })
  return (
    <div ref={stripRef} className="fb-gal-strip">
      <div style={{ position: 'relative', width: virtualizer.getTotalSize(), height: STRIP_H }}>
        {virtualizer.getVirtualItems().map((vi) => {
          const f = files[vi.index]
          return (
            <div key={f.path} style={{ position: 'absolute', top: 0, left: 0, height: '100%', width: vi.size, transform: `translateX(${vi.start}px)` }}>
              <GalThumb file={f} active={f.path === focusedPath} projectId={projectId} onFocus={() => onFocus(f.path)} onOpen={() => onOpen(f.path)} onItemContext={onItemContext} rename={rename} onItemDragStart={onItemDragStart} />
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── 画廊视图：顶部大预览（聚焦文件，渲染真实内容）+ 底部缩略条 ────────────────
function GalleryView({ files, onOpen, projectId, onItemContext, rename, onItemDragStart }: { files: FileNode[]; onOpen: (p: string) => void; projectId: string; onItemContext: (file: FileNode, e: React.MouseEvent) => void; rename?: RenameCtx; onItemDragStart: (file: FileNode, e: React.DragEvent) => void }) {
  const [focusPath, setFocusPath] = useState<string>('')
  const focused = files.find((f) => f.path === focusPath) ?? files[0]

  if (!focused) {
    return <div className="fb-gallery is-empty"><div className="fb-folder-empty">（当前目录没有文件）</div></div>
  }
  return (
    <div className="fb-gallery">
      <div className="fb-gal-stage">
        <Preview projectId={projectId} activeFile={focused.path} embedded />
      </div>
      <div className="fb-gal-caption">
        <span className="fb-gal-name" title={focused.path}>{focused.name}</span>
        <button type="button" className="fb-gal-open" onClick={() => onOpen(focused.path)}>在标签页打开</button>
      </div>
      <GalleryStrip files={files} focusedPath={focused.path} projectId={projectId} onFocus={setFocusPath} onOpen={onOpen} onItemContext={onItemContext} rename={rename} onItemDragStart={onItemDragStart} />
    </div>
  )
}

// ── FileList 组件 ──────────────────────────────────────────────────────────────

interface FileListProps {
  nodes: FileNode[]
  /** 当前选中目录（''=项目根），右侧列表据此联动（Issue 16）。 */
  selectedDir: string
  onOpen: (path: string) => void
  /** 当前项目 ID：据此拼 raw URL，给预览 / 缩略图渲染真实内容。 */
  projectId: string
  /** 拖放进行中：放置区高亮（拖放热区在父面板 FileWorkspace 上） */
  dragActive?: boolean
  /** 右键文件项（node）/ 列表空白（node=null）；targets 为命中组（本阶段为单项，多选见 §5.3）。容器据此构造菜单。 */
  onContext?: (node: FileNode | null, targets: string[], e: React.MouseEvent) => void
  /** 内联重命名上下文（source==='list' 时由容器下发）。 */
  rename?: RenameCtx
  /** 内部拖拽起手：把拖拽组（多选则整组、否则单项）写进 dataTransfer + 容器 ref（§5.6）。 */
  onDragStartPaths?: (paths: string[], e: React.DragEvent) => void
}

export function FileList({ nodes, selectedDir, onOpen, projectId, dragActive = false, onContext, rename, onDragStartPaths }: FileListProps) {
  const [view, setView] = useState<ViewMode>(loadViewMode)
  const changeView = (m: ViewMode) => { setView(m); saveViewMode(m) }
  const [gridSize, setGridSize] = useState<number>(loadGridSize)
  const changeGridSize = (n: number) => { setGridSize(n); saveGridSize(n) }
  // 列表 / 网格虚拟化共用的滚动容器
  const scrollRef = useRef<HTMLDivElement>(null)

  const children = childrenOf(nodes, selectedDir)

  // ── 键盘多选（仅 list / icons；gallery 不参与，§5.2）──────────────────────────
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const anchorRef = useRef<string | null>(null)
  // 当前视图可见文件的有序路径（Shift 连续区间按此顺序）。list 按扁平行序、icons 按 collectFiles 序。
  const orderedPaths = useMemo(() => (
    view === 'list'
      ? flattenList(children).flatMap((it) => (it.kind === 'row' ? [it.file.path] : []))
      : collectFiles(children).map((f) => f.path)
  ), [children, view])

  // 切目录 / 切视图后清空选中（避免选中跨目录的残留 path）
  useEffect(() => { setSelected(new Set()); anchorRef.current = null }, [selectedDir, view])

  // 单击=选中（清空其余）；Cmd/Ctrl=切换；Shift=锚点到当前的连续区间；双击=打开（在叶子上接 onDoubleClick）
  const onItemClick = (file: FileNode, e: React.MouseEvent) => {
    e.stopPropagation()   // 阻断冒泡到 .fb-main 的「点空白清空」
    const path = file.path
    if (e.metaKey || e.ctrlKey) {
      setSelected((prev) => { const next = new Set(prev); next.has(path) ? next.delete(path) : next.add(path); return next })
      anchorRef.current = path
    } else if (e.shiftKey && anchorRef.current) {
      const a = orderedPaths.indexOf(anchorRef.current), b = orderedPaths.indexOf(path)
      if (a !== -1 && b !== -1) { const [lo, hi] = a < b ? [a, b] : [b, a]; setSelected(new Set(orderedPaths.slice(lo, hi + 1))) }
      else { setSelected(new Set([path])); anchorRef.current = path }
    } else {
      setSelected(new Set([path])); anchorRef.current = path
    }
  }

  // 内部拖拽起手：拖的项在多选组内 → 拖整组（按可见顺序）；否则只拖该项。
  const onItemDragStart = (file: FileNode, e: React.DragEvent) => {
    const payload = (selected.has(file.path) && selected.size > 1) ? orderedPaths.filter((p) => selected.has(p)) : [file.path]
    onDragStartPaths?.(payload, e)
  }

  // 右键命中规则（§5.3）：右键项在选中组内 → 菜单作用于整组（按可见顺序）；否则先重置为该单项再弹。
  const handleItemContext = (file: FileNode, e: React.MouseEvent) => {
    e.preventDefault(); e.stopPropagation()
    let targets: string[]
    if (selected.has(file.path) && selected.size > 1) {
      targets = orderedPaths.filter((p) => selected.has(p))
    } else {
      setSelected(new Set([file.path])); anchorRef.current = file.path
      targets = [file.path]
    }
    onContext?.(file, targets, e)
  }

  return (
    <div
      className="fb-main"
      ref={scrollRef}
      onClick={() => { setSelected(new Set()); anchorRef.current = null }}
      onContextMenu={(e) => { e.preventDefault(); onContext?.(null, [], e) }}
    >
      <div className="fb-bar">
        <ViewSeg mode={view} onChange={changeView} />
      </div>

      {view === 'gallery' ? (
        <GalleryView files={collectFiles(children)} onOpen={onOpen} projectId={projectId} onItemContext={handleItemContext} rename={rename} onItemDragStart={onItemDragStart} />
      ) : view === 'icons' ? (
        <IconGridView files={collectFiles(children)} onOpen={onOpen} projectId={projectId} size={gridSize} scrollRef={scrollRef} onItemContext={handleItemContext} rename={rename} selected={selected} onItemClick={onItemClick} onItemDragStart={onItemDragStart} />
      ) : (
        <>
          <div className="fb-head">
            <span className="fb-col-name">名称</span>
            <span className="fb-col-type">类型</span>
            <span className="fb-col-time">修改时间</span>
            <span className="fb-col-ctime">创建时间</span>
          </div>
          <ListView children={children} onOpen={onOpen} projectId={projectId} scrollRef={scrollRef} onItemContext={handleItemContext} rename={rename} selected={selected} onItemClick={onItemClick} onItemDragStart={onItemDragStart} />
        </>
      )}

      <div className={`fb-dropzone${dragActive ? ' is-dragover' : ''}`}>
        <div className="fb-dz-title">↧ 把文件拖到这里</div>
        <div className="fb-dz-sub">图片、文档、参考资料或文件夹 — 拖入即复制进当前项目。</div>
      </div>

      {/* 图标网格：右下角尺寸滑杆（锚定 .fw-body 右下角） */}
      {view === 'icons' && <SizeSlider value={gridSize} onChange={changeGridSize} />}
    </div>
  )
}
