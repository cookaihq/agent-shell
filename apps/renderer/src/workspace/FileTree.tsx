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

import { useState } from 'react'
import type { FileNode } from '../api/types'

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

// ── 文件扩展名 → 短标识（对齐原型 workspace.html L129-130）─────────────────
function fileTag(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'html' || ext === 'htm') return '</>'
  if (ext === 'css') return '#'
  if (ext === 'md') return 'M↓'
  if (ext === 'json') return '{ }'
  if (ext === 'ts' || ext === 'tsx') return 'TS'
  if (ext === 'js' || ext === 'jsx') return 'JS'
  return ext.toUpperCase() || '·'
}

// ── 递归节点组件 ──────────────────────────────────────────────────────────────

interface TreeNodeProps {
  node: FileNode
  depth: number
  activeNodePath: string | null
  onActivate: (path: string, isFolder: boolean) => void
  onOpen: (path: string) => void
}

// 注入/系统目录（dot 目录，如 .claude / .superpowers）默认折叠，避免注入技能把深层目录全展开（Issue 6）；
// 用户自己的内容目录（非 dot）仍默认展开。
function defaultCollapsed(node: FileNode): boolean {
  return node.type === 'dir' && node.name.startsWith('.')
}

function TreeNode({ node, depth, activeNodePath, onActivate, onOpen }: TreeNodeProps) {
  const [collapsed, setCollapsed] = useState(() => defaultCollapsed(node))

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

  return (
    <>
      <div
        className={`fb-tnode${isFolder ? ' is-folder' : ''}${collapsed ? ' collapsed' : ''}${isActive ? ' is-active' : ''}`}
        data-depth={depth}
        onClick={handleClick}
      >
        <span className="caret">{isFolder ? <ChevronIcon /> : null}</span>
        {isFolder ? (
          <FolderIcon />
        ) : (
          <span className="ti tf">{fileTag(node.name)}</span>
        )}
        <span className="tname">{node.name}</span>
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
}

export function FileTree({ nodes, onOpen, onRefresh, onSelectDir, onCreate }: FileTreeProps) {
  // 全局 activeNodePath（任何节点被点击时高亮，文件夹点击也高亮）
  const [activeNodePath, setActiveNodePath] = useState<string | null>(null)
  // 内联新建：'file' / 'dir' / null（点工具栏按钮进入，输入名字回车创建）
  const [creating, setCreating] = useState<'file' | 'dir' | null>(null)
  const [draft, setDraft] = useState('')

  const handleActivate = (path: string, isFolder: boolean) => {
    setActiveNodePath(path)
    onSelectDir?.(isFolder ? path : parentDir(path))
  }

  const startCreate = (kind: 'file' | 'dir') => { setCreating(kind); setDraft('') }
  const commitCreate = () => {
    const name = draft.trim()
    if (name && creating) onCreate?.(name, creating)
    setCreating(null); setDraft('')
  }

  return (
    <div className="fb-tree">
      <div className="fb-tree-toolbar">
        <span className="fb-tree-title">资源管理器</span>
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
        />
      ))}
    </div>
  )
}
