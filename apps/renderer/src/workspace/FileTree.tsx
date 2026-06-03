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
  onActivate: (path: string) => void
  onOpen: (path: string) => void
}

function TreeNode({ node, depth, activeNodePath, onActivate, onOpen }: TreeNodeProps) {
  const [collapsed, setCollapsed] = useState(false)

  const isFolder = node.type === 'dir'
  const isActive = activeNodePath === node.path

  const handleClick = () => {
    onActivate(node.path)
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
        <span className="caret">{isFolder ? '▾' : ''}</span>
        {isFolder ? (
          <FolderIcon />
        ) : (
          <span className="ti tf">{fileTag(node.name)}</span>
        )}
        {node.name}
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

interface FileTreeProps {
  nodes: FileNode[]
  /** 点文件时调用（path 为不带尾斜杠的相对路径） */
  onOpen: (path: string) => void
}

export function FileTree({ nodes, onOpen }: FileTreeProps) {
  // 全局 activeNodePath（任何节点被点击时高亮，文件夹点击也高亮）
  const [activeNodePath, setActiveNodePath] = useState<string | null>(null)

  const handleActivate = (path: string) => {
    setActiveNodePath(path)
  }

  const handleOpen = (path: string) => {
    onOpen(path)
  }

  return (
    <div className="fb-tree">
      <div className="fb-tree-toolbar">
        <span className="fb-tree-title">资源管理器</span>
        <span className="fb-tree-tools">
          <button className="chat-hicon" title="新建文件" type="button">
            <NewFileIcon />
          </button>
          <button className="chat-hicon" title="新建文件夹" type="button">
            <NewFolderIcon />
          </button>
          <button className="chat-hicon" title="刷新" type="button">
            <RefreshIcon />
          </button>
        </span>
      </div>
      {nodes.map(node => (
        <TreeNode
          key={node.path}
          node={node}
          depth={0}
          activeNodePath={activeNodePath}
          onActivate={handleActivate}
          onOpen={handleOpen}
        />
      ))}
    </div>
  )
}
