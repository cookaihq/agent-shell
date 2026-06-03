/**
 * FileWorkspace.tsx — Task 19 + Task 20
 *
 * 文件工作区容器。替换 Workspace.tsx 右栏占位 <div className="fw" />。
 * 高保真对照原型 workspace.html L97-165 + app.js file workspace IIFE L452-556。
 *
 * 结构：
 *   .fw
 *     > .fw-tabs
 *         > button.fw-ftab[data-ftab="files"] 「文件」固定 tab
 *         > .fw-ftablist  文件 tab（可×关闭）
 *         > .fw-views     视图 tab（仅「预览」）
 *     > .fw-body
 *         > .fw-panel[data-fw="files"]   文件浏览器（.file-browser > .fb-tree + .fb-main）
 *         > .fw-panel[data-fw="preview"] 预览面板（<Preview />）
 *
 * 状态（移植 app.js L456-458）：
 *   - activeFileKey: 'files'（文件浏览器）| path（已打开的文件）
 *   - activeView: 'preview'（仅一个视图）
 *   - openTabs: 已打开的文件 tab 列表（path[]，去重）
 *
 * 交互（移植 app.js render L461-477）：
 *   - 浏览文件时（activeFileKey='files'）：views 隐藏，files panel 激活
 *   - 打开文件时：views 显示，preview panel 激活
 *   - 点文件 tab：切换 activeFileKey
 *   - × 关 tab：从 openTabs 移除；若关的是当前 → 切回 'files'
 *   - onActiveFile 联动：activeFileKey 变化时通知 Workspace（CtxFile）
 */

import { useEffect, useState } from 'react'
import type { AgentShellBridge } from '@agent-shell/contracts'
import { api } from '../api/client'
import { FileTree } from './FileTree'
import { FileList } from './FileList'
import { Preview } from './Preview'
import type { FileNode } from '../api/types'

// 从拖放事件取一组源磁盘绝对路径。Electron 32+ 已移除 File.path，统一经 preload 的 webUtils.getPathForFile。
// 浏览器/dev（无 agentShell 桥）下返回空数组 → 不导入（拖放是桌面壳能力）。
function pathsFromDrop(e: React.DragEvent): string[] {
  const bridge = (globalThis as { agentShell?: AgentShellBridge }).agentShell
  if (!bridge?.getPathForFile) return []
  return Array.from(e.dataTransfer.files).map(f => bridge.getPathForFile(f)).filter(Boolean)
}

// ── SVG 图标 ──────────────────────────────────────────────────────────────────

const FilesIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

// ── FileWorkspace 组件 ────────────────────────────────────────────────────────

interface FileWorkspaceProps {
  projectId: string
  /** 当前打开文件路径（null=无/浏览器模式），通知 Workspace → Composer → CtxFile */
  onActiveFile: (path: string | null) => void
}

export function FileWorkspace({ projectId, onActiveFile }: FileWorkspaceProps) {
  const [tree, setTree] = useState<FileNode[]>([])
  // 当前激活的 key：'files' 表示浏览器模式，否则为文件路径
  const [activeFileKey, setActiveFileKey] = useState<string>('files')
  // 已打开的文件 tab 列表（去重有序）
  const [openTabs, setOpenTabs] = useState<string[]>([])
  // 视图 tab（仅「预览」）
  const [activeView] = useState<string>('preview')
  // 拖放进行中：整个文件面板高亮提示
  const [dragActive, setDragActive] = useState(false)

  // 加载目录树
  useEffect(() => {
    if (!projectId) return
    api.files(projectId)
      .then(({ tree: t }) => setTree(t))
      .catch(() => { /* 静默失败 */ })
  }, [projectId])

  // 通知 Workspace activeFile 变化
  useEffect(() => {
    onActiveFile(activeFileKey === 'files' ? null : activeFileKey)
  }, [activeFileKey, onActiveFile])

  // 打开文件（点树节点或文件列表行）
  const openFile = (path: string) => {
    if (!openTabs.includes(path)) {
      setOpenTabs(prev => [...prev, path])
    }
    setActiveFileKey(path)
  }

  // 关闭 tab（× 按钮）
  const closeTab = (path: string, e: React.MouseEvent) => {
    e.stopPropagation()
    setOpenTabs(prev => prev.filter(p => p !== path))
    if (activeFileKey === path) {
      setActiveFileKey('files')
    }
  }

  // 拖入文件/文件夹 → 复制进项目根 → 刷新树
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragActive(false)
    const paths = pathsFromDrop(e)
    if (paths.length === 0) return
    try {
      const { tree: t } = await api.importFiles(projectId, paths)
      setTree(t)
    } catch { /* 静默失败 */ }
  }
  const onDragOver = (e: React.DragEvent) => {
    // 仅当拖的是文件时拦截（允许 drop）并高亮
    if (Array.from(e.dataTransfer.types).includes('Files')) {
      e.preventDefault()
      setDragActive(true)
    }
  }
  const onDragLeave = (e: React.DragEvent) => {
    // 离开面板自身（而非进入子元素）才取消高亮
    if (e.currentTarget === e.target) setDragActive(false)
  }

  const isFiles = activeFileKey === 'files'

  return (
    <div className="fw" data-testid="file-workspace">
      {/* 标签栏 */}
      <div className="fw-tabs">
        {/* 固定「文件」tab */}
        <button
          className={`fw-ftab${isFiles ? ' is-active' : ''}`}
          data-ftab="files"
          type="button"
          onClick={() => setActiveFileKey('files')}
        >
          <FilesIcon />
          文件
        </button>

        {/* 可关闭的文件 tab 列表 */}
        <div className="fw-ftablist">
          {openTabs.map(path => {
            const name = path.split('/').pop() ?? path
            return (
              <button
                key={path}
                className={`fw-ftab${activeFileKey === path ? ' is-active' : ''}`}
                data-ftab={path}
                type="button"
                onClick={() => setActiveFileKey(path)}
              >
                <span className="ftab-label">{name}</span>
                <span
                  className="ftab-x"
                  title="关闭"
                  onClick={(e) => closeTab(path, e)}
                >×</span>
              </button>
            )
          })}
        </div>

        {/* 视图 tab（浏览文件时隐藏） */}
        <div className="fw-views" style={{ display: isFiles ? 'none' : '' }}>
          <button
            className={`fw-tab${activeView === 'preview' ? ' is-active' : ''}`}
            data-fw="preview"
            type="button"
          >
            预览
          </button>
        </div>
      </div>

      {/* 内容区 */}
      <div className="fw-body">
        {/* 文件浏览器 panel —— 整个面板为拖放热区 */}
        <div
          className={`fw-panel${isFiles ? ' is-active' : ''}${dragActive ? ' is-dragover' : ''}`}
          data-fw="files"
          onDragOver={onDragOver}
          onDragLeave={onDragLeave}
          onDrop={onDrop}
        >
          <div className="file-browser">
            <FileTree nodes={tree} onOpen={openFile} />
            <FileList nodes={tree} activeFileKey={activeFileKey} onOpen={openFile} dragActive={dragActive} />
          </div>
        </div>

        {/* 预览 panel */}
        <div
          className={`fw-panel${!isFiles && activeView === 'preview' ? ' is-active' : ''}`}
          data-fw="preview"
        >
          <Preview
            projectId={projectId}
            activeFile={isFiles ? null : activeFileKey}
          />
        </div>
      </div>
    </div>
  )
}
