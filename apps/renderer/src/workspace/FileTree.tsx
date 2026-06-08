/**
 * FileTree.tsx — Task 19
 *
 * 递归渲染目录树。
 * 高保真对照原型 workspace.html L114-143 + app.js L531-553。
 *
 * 结构：
 *   .fb-tree > .fb-tree-toolbar
 *           + recursive(.fb-tnode[.is-folder][.collapsed][.is-active] + .fb-tchildren[hidden])
 *
 * 交互（移植 app.js L531-553）：
 *   - 点文件夹：toggle collapsed + hidden（展开/收起子节点）
 *   - 点文件：所有节点 is-active 清空 → 当前节点 is-active + onOpen(path)
 */

import { useState, useEffect } from 'react'
import type { FileNode } from '../api/types'
import type { EditorEntry } from '@agent-shell/contracts'
import { RenameInput, type RenameCtx } from './RenameInput'
import { fileTag } from '../utils/fileTag'

/** 内部拖拽移动上下文（§5.6）：begin=拖起设标记、canDrop=能否放进 destDir、drop=落点移动；mime 用于区分内/外拖拽。 */
export interface TreeDnd {
  mime: string
  begin: (paths: string[], e: React.DragEvent) => void
  canDrop: (destDir: string) => boolean
  drop: (destDir: string, e: React.DragEvent) => void
}

// ── SVG 图标 ──────────────────────────────────────────────────────────────────

const FolderIcon = () => (
  <svg className="ti" width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

// 文件夹展开/收起 chevron（VS Code 风格细折线，展开时 CSS 旋 90° 向下）
const ChevronIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2.2}
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M9 6l6 6-6 6" />
  </svg>
)

// 标题旁「在编辑器中打开」下拉的朝下 caret
const CaretDownIcon = () => (
  <svg width="12" height="12" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2.2}
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
)

// 软链接角标（VS Code 资源管理器对 symlink 的小箭头标识）
const SymlinkBadge = () => (
  <svg className="tlink" width="11" height="11" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2.4}
    strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M7 17L17 7" />
    <path d="M8 7h9v9" />
  </svg>
)

// 新建文件图标（toolbar）
const NewFileIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h6" />
    <path d="M14 3v5h5" />
    <path d="M18 14v6M15 17h6" />
  </svg>
)

// 新建文件夹图标（toolbar）
const NewFolderIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v3" />
    <path d="M3 7v10a2 2 0 0 0 2 2h7" />
    <path d="M18 14v6M15 17h6" />
  </svg>
)

// 刷新图标（toolbar）
const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M21 12a9 9 0 1 1-3-6.7" strokeLinecap="round" />
    <path d="M21 4v5h-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

// 文件扩展名 → 短标识：见 ../utils/fileTag（与 CtxFile 共用）。

// ── 递归节点组件 ──────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: FileNode
  depth: number
  activeNodePath: string | null
  onActivate: (path: string, isFolder: boolean) => void
  onOpen: (path: string) => void
  /** 右键节点：上报给容器构造菜单（节点本身，不在树内多选）。 */
  onContext?: (node: FileNode, e: React.MouseEvent) => void
  /** 内联重命名上下文（命中本节点 path 时把名字换成输入框）。 */
  rename?: RenameCtx
  /** 内部拖拽移动上下文（节点作拖源；文件夹作放置目标）。 */
  dnd?: TreeDnd
}

// 所有文件夹默认折叠，逐个点开（用户要求，feedback-2 Issue 7）。
// dot 目录（如 .claude / .superpowers）同样折叠，与新策略一致。
function defaultCollapsed(node: FileNode): boolean {
  return node.type === 'dir'
}

function TreeNode({ node, depth, activeNodePath, onActivate, onOpen, onContext, rename, dnd }: TreeNodeProps) {
  const [collapsed, setCollapsed] = useState(() => defaultCollapsed(node))
  const [dropTarget, setDropTarget] = useState(false)

  const isFolder = node.type === 'dir'
  const isActive = activeNodePath === node.path

  const handleClick = () => {
    onActivate(node.path, isFolder)
    if (isFolder) {
      setCollapsed(c => !c)
    } else {
      onOpen(node.path)
    }
  }

  // 文件夹作放置目标：仅对内部拖拽（dataTransfer 带本应用 MIME）且不放进自身/子孙时高亮并允许 drop。
  const onDragOver = (e: React.DragEvent) => {
    if (!dnd || !isFolder) return
    if (!e.dataTransfer.types.includes(dnd.mime) || !dnd.canDrop(node.path)) return
    e.preventDefault(); e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'
    if (!dropTarget) setDropTarget(true)
  }

  return (
    <>
      <div
        className={`fb-tnode${isFolder ? ' is-folder' : ''}${collapsed ? ' collapsed' : ''}${isActive ? ' is-active' : ''}${dropTarget ? ' is-droptarget' : ''}`}
        data-depth={depth}
        draggable={!!dnd && rename?.path !== node.path}
        onClick={handleClick}
        onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); onContext?.(node, e) }}
        onDragStart={(e) => { e.stopPropagation(); dnd?.begin([node.path], e) }}
        onDragOver={onDragOver}
        onDragLeave={() => { if (dropTarget) setDropTarget(false) }}
        onDrop={(e) => { if (!dnd || !isFolder) return; e.stopPropagation(); setDropTarget(false); dnd.drop(node.path, e) }}
      >
        <span className="caret">{isFolder ? <ChevronIcon /> : null}</span>
        {isFolder ? (
          <FolderIcon />
        ) : (
          <span className="ti tf">{fileTag(node.name)}</span>
        )}
        {rename?.path === node.path ? (
          <RenameInput name={node.name} onSubmit={(n) => rename.submit(node.path, n)} onCancel={rename.cancel} />
        ) : (
          <span className="tname">{node.name}</span>
        )}
        {node.symlink && (
          <span className="tlink-wrap" title="符号链接（symlink）">
            <SymlinkBadge />
          </span>
        )}
      </div>
      {isFolder && (
        <div className="fb-tchildren" hidden={collapsed}>
          {(node.children ?? []).map(child => (
            <TreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              activeNodePath={activeNodePath}
              onActivate={onActivate}
              onOpen={onOpen}
              onContext={onContext}
              rename={rename}
              dnd={dnd}
            />
          ))}
        </div>
      )}
    </>
  )
}

// ── FileTree 组件 ──────────────────────────────────────────────────────────────

// 文件路径的父目录（''=项目根）。
function parentDir(path: string): string {
  const i = path.lastIndexOf('/')
  return i === -1 ? '' : path.slice(0, i)
}

interface FileTreeProps {
  nodes: FileNode[]
  /** 点文件时调用（path 为不带尾斜杠的相对路径） */
  onOpen: (path: string) => void
  /** 刷新目录树（重新拉 api.files）。缺省时刷新按钮禁用。（Issue 20） */
  onRefresh?: () => void
  /** 选中目录变化（文件夹→其自身、文件→其父目录、''=根）：新建落点 + 右侧列表联动（Issue 15/16） */
  onSelectDir?: (dir: string) => void
  /** 新建文件/目录（Issue 15）：name 为名字，落点由 onSelectDir 维护在父层 */
  onCreate?: (name: string, kind: 'file' | 'dir') => void
  /** 右键节点（文件/文件夹）；node=null 表示右键树空白区。容器据此构造菜单。 */
  onContext?: (node: FileNode | null, e: React.MouseEvent) => void
  /** 内联重命名上下文（source==='tree' 时由容器下发）。 */
  rename?: RenameCtx
  /** 「在此新建」信号：seq 变化即进入内联新建态（落点由容器先 setSelectedDir 决定）。 */
  createReq?: { kind: 'file' | 'dir'; seq: number }
  /** 内部拖拽移动上下文（§5.6）。 */
  dnd?: TreeDnd
  /** 「在编辑器中打开」名单（已安装在前、未安装灰置底）；空/未传 → 不渲染 caret。 */
  editors?: EditorEntry[]
  /** 首次准备展开下拉时触发（让容器懒检测）。 */
  onRequestEditors?: () => void
  /** 点已安装编辑器项 → 用它打开项目根目录。 */
  onOpenInEditor?: (id: string) => void
}

export function FileTree({ nodes, onOpen, onRefresh, onSelectDir, onCreate, onContext, rename, createReq, dnd, editors, onRequestEditors, onOpenInEditor }: FileTreeProps) {
  // 全局 activeNodePath（任何节点被点击时高亮，文件夹点击也高亮）
  const [activeNodePath, setActiveNodePath] = useState<string | null>(null)
  // 内联新建：'file' / 'dir' / null（点工具栏按钮进入，输入名字回车创建）
  const [creating, setCreating] = useState<'file' | 'dir' | null>(null)
  const [draft, setDraft] = useState('')

  // 「在编辑器中打开」下拉：开关 + fixed 浮层坐标（.fb-tree overflow 会裁绝对定位，故用 fixed）
  const [editorMenu, setEditorMenu] = useState<{ left: number; top: number } | null>(null)
  // caret 可见性只看「功能可用」（容器传了数组=有桌面壳桥，含空数组），与「是否已检测到编辑器」解耦：
  // 检测是懒触发（首次点 caret 才 onRequestEditors），若用 length>0 把可见性耦合到检测结果，
  // 首启 editors=[] → 无 caret → 无法点 → 永不检测 → 永无 caret（死锁）。
  const editorMenuEnabled = editors !== undefined
  const openEditorMenu = (e: React.MouseEvent) => {
    if (editorMenu) { setEditorMenu(null); return }
    onRequestEditors?.()
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const width = 208
    const left = Math.max(8, Math.min(r.left, window.innerWidth - 8 - width))
    setEditorMenu({ left, top: r.bottom + 4 })
  }
  useEffect(() => {
    if (!editorMenu) return
    const close = () => setEditorMenu(null)
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setEditorMenu(null) }
    const onDocClick = (e: MouseEvent) => {
      const t = e.target as HTMLElement
      if (!t.closest('.fb-editor-menu') && !t.closest('.fb-tree-titlebtn')) setEditorMenu(null)
    }
    window.addEventListener('resize', close)
    window.addEventListener('scroll', close, true)
    document.addEventListener('keydown', onKey)
    document.addEventListener('click', onDocClick)
    return () => {
      window.removeEventListener('resize', close)
      window.removeEventListener('scroll', close, true)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('click', onDocClick)
    }
  }, [editorMenu])

  const handleActivate = (path: string, isFolder: boolean) => {
    setActiveNodePath(path)
    onSelectDir?.(isFolder ? path : parentDir(path))
  }

  const startCreate = (kind: 'file' | 'dir') => { setCreating(kind); setDraft('') }
  // 容器「在此新建」信号 → 进入内联新建态（落点已由容器 setSelectedDir 设好）
  useEffect(() => {
    if (createReq) { setCreating(createReq.kind); setDraft('') }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createReq?.seq])
  const commitCreate = () => {
    const name = draft.trim()
    if (name && creating) onCreate?.(name, creating)
    setCreating(null); setDraft('')
  }

  return (
    <div className="fb-tree" onContextMenu={(e) => { e.preventDefault(); onContext?.(null, e) }}>
      <div className="fb-tree-toolbar">
        {editorMenuEnabled ? (
          <button className="fb-tree-titlebtn" type="button" title="在编辑器中打开"
            aria-haspopup="menu" aria-expanded={!!editorMenu} onClick={openEditorMenu}>
            <span className="fb-tree-title">资源管理器</span>
            <span className="fb-tree-caret"><CaretDownIcon /></span>
          </button>
        ) : (
          <span className="fb-tree-title">资源管理器</span>
        )}
        <span className="fb-tree-tools">
          <button className="chat-hicon" title="新建文件" type="button" onClick={() => startCreate('file')} disabled={!onCreate}>
            <NewFileIcon />
          </button>
          <button className="chat-hicon" title="新建文件夹" type="button" onClick={() => startCreate('dir')} disabled={!onCreate}>
            <NewFolderIcon />
          </button>
          <button className="chat-hicon" title="刷新" type="button" onClick={onRefresh} disabled={!onRefresh}>
            <RefreshIcon />
          </button>
        </span>
      </div>
      {editorMenu && editorMenuEnabled && (
        <div className="fb-editor-menu" role="menu" style={{ left: editorMenu.left, top: editorMenu.top }}>
          <div className="fb-editor-head">在哪个编辑器中打开？</div>
          {editors!.filter(e => e.installed).map(e => (
            <button key={e.id} className="menu-item" type="button" role="menuitem"
              onClick={() => { setEditorMenu(null); onOpenInEditor?.(e.id) }}>
              <span className="fb-edicon">{e.label.slice(0, 2)}</span><span>{e.label}</span>
            </button>
          ))}
          {editors!.some(e => !e.installed) && <div className="fb-editor-sep">未安装</div>}
          {editors!.filter(e => !e.installed).map(e => (
            <div key={e.id} className="menu-item is-disabled">
              <span className="fb-edicon">{e.label.slice(0, 2)}</span><span>{e.label}</span>
            </div>
          ))}
        </div>
      )}
      {creating && (
        <div className="fb-create">
          <span className="fb-create-ic">{creating === 'dir' ? <FolderIcon /> : <NewFileIcon />}</span>
          <input
            className="fb-create-input"
            autoFocus
            placeholder={creating === 'dir' ? '新建文件夹名…' : '新建文件名…'}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitCreate() }
              else if (e.key === 'Escape') { e.preventDefault(); setCreating(null); setDraft('') }
            }}
            onBlur={commitCreate}
          />
        </div>
      )}
      {nodes.map(node => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          activeNodePath={activeNodePath}
          onActivate={handleActivate}
          onOpen={onOpen}
          onContext={onContext}
          rename={rename}
          dnd={dnd}
        />
      ))}
    </div>
  )
}
