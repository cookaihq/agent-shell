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

import { useCallback, useEffect, useRef, useState } from 'react'
import type { AgentShellBridge } from '@agent-shell/contracts'
import { api } from '../api/client'
import { useSplitDrag } from '../hooks/useSplitDrag'
import { useFsWatch } from '../hooks/useFsWatch'
import { FileTree } from './FileTree'
import { FileList } from './FileList'
import { Preview } from './Preview'
import { CommandPreview } from './CommandPreview'
import type { OpenCommand } from './ChatLog'
import type { FileNode } from '../api/types'

const CMD_PREFIX = 'cmd:'

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
  /** 点击运行命令卡的请求（seq 变化即触发开/更新命令 tab）。 */
  openCmd?: { cmd: OpenCommand; seq: number } | null
}

export function FileWorkspace({ projectId, onActiveFile, openCmd }: FileWorkspaceProps) {
  const [tree, setTree] = useState<FileNode[]>([])
  // 当前激活的 key：'files' 浏览器 / 文件路径 / 'cmd:<id>' 命令 tab
  const [activeFileKey, setActiveFileKey] = useState<string>('files')
  // 已打开的文件 tab 列表（去重有序）
  const [openTabs, setOpenTabs] = useState<string[]>([])
  // 已打开的命令 tab（按点击顺序，去重 by id；同 id 再点更新其数据）
  const [cmdTabs, setCmdTabs] = useState<OpenCommand[]>([])

  // 点击运行命令卡 → 开/更新命令 tab 并激活
  useEffect(() => {
    if (!openCmd) return
    const { cmd } = openCmd
    setCmdTabs((prev) => {
      const idx = prev.findIndex((c) => c.id === cmd.id)
      if (idx === -1) return [...prev, cmd]
      const next = [...prev]; next[idx] = cmd; return next   // 更新输出（可能从运行中→完成）
    })
    setActiveFileKey(CMD_PREFIX + cmd.id)
  }, [openCmd?.seq])
  // 视图 tab（仅「预览」）
  const [activeView] = useState<string>('preview')
  // 拖放进行中：整个文件面板高亮提示
  const [dragActive, setDragActive] = useState(false)
  // 文件浏览器内部分隔条：左目录树 ↔ 右文件列表（树最小 150、列表最小 240）
  const { containerRef: fbRef, handleProps: fbHandle, cols: fbCols } = useSplitDrag({ minLeft: 150, minRight: 240 })

  // 当前选中的文件夹相对路径（''=项目根）：新建文件/夹的落点（Issue 15）+ 右侧列表联动（Issue 16）
  const [selectedDir, setSelectedDir] = useState('')

  // 重新拉取目录树（手动刷新按钮 + 切项目时复用，Issue 20）
  const refreshTree = useCallback(() => {
    if (!projectId) return
    api.files(projectId)
      .then(({ tree: t }) => setTree(t))
      .catch(() => { /* 静默失败 */ })
  }, [projectId])

  // 加载目录树（切项目时）
  useEffect(() => { refreshTree() }, [refreshTree])

  // 项目目录变更 → 防抖重拉（Issue 19 根治：覆盖 agent / 命令行 / 外部程序一切来源；手动刷新按钮兜底）
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const debouncedRefresh = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => { debounceRef.current = null; refreshTree() }, 300)
  }, [refreshTree])
  useFsWatch(projectId || null, debouncedRefresh)

  // 新建文件/目录（Issue 15）：落点 = 当前选中目录（无则项目根）；建成后刷新树，文件则打开
  const handleCreate = useCallback(async (name: string, kind: 'file' | 'dir') => {
    const clean = name.trim()
    if (!clean) return
    const rel = selectedDir ? `${selectedDir}/${clean}` : clean
    try {
      const { tree: t } = await api.createEntry(projectId, rel, kind)
      setTree(t)
      if (kind === 'file') { setOpenTabs((prev) => (prev.includes(rel) ? prev : [...prev, rel])); setActiveFileKey(rel) }
    } catch { /* 同名/越界等：静默（后续可加 toast） */ }
  }, [projectId, selectedDir])

  // 通知 Workspace activeFile 变化（命令 tab 不是真实文件 → null）
  useEffect(() => {
    onActiveFile(activeFileKey === 'files' || activeFileKey.startsWith(CMD_PREFIX) ? null : activeFileKey)
  }, [activeFileKey, onActiveFile])

  // 打开文件（点树节点或文件列表行）
  const openFile = (path: string) => {
    if (!openTabs.includes(path)) {
      setOpenTabs(prev => [...prev, path])
    }
    setActiveFileKey(path)
  }

  // 关闭 tab（× 按钮）——文件 tab 与命令 tab 通用
  const closeTab = (key: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (key.startsWith(CMD_PREFIX)) setCmdTabs(prev => prev.filter(c => CMD_PREFIX + c.id !== key))
    else setOpenTabs(prev => prev.filter(p => p !== key))
    if (activeFileKey === key) setActiveFileKey('files')
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
  const isCmd = activeFileKey.startsWith(CMD_PREFIX)
  const activeCmd = isCmd ? cmdTabs.find(c => CMD_PREFIX + c.id === activeFileKey) ?? null : null

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

        {/* 可关闭的文件 tab + 命令 tab 列表 */}
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
          {cmdTabs.map(c => {
            const key = CMD_PREFIX + c.id
            // tab 标签：读取/编辑用文件名；命令缺省取首词
            const label = c.tabLabel ?? ('$ ' + (c.command.trim().split(/\s+/).slice(0, 2).join(' ').slice(0, 18) || '命令'))
            return (
              <button
                key={key}
                className={`fw-ftab fw-ftab-cmd${activeFileKey === key ? ' is-active' : ''}`}
                type="button"
                onClick={() => setActiveFileKey(key)}
              >
                <span className="ftab-label">{label}</span>
                <span className="ftab-x" title="关闭" onClick={(e) => closeTab(key, e)}>×</span>
              </button>
            )
          })}
        </div>

        {/* 视图 tab（浏览文件 / 命令 tab 时隐藏） */}
        <div className="fw-views" style={{ display: isFiles || isCmd ? 'none' : '' }}>
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
          <div
            className="file-browser"
            ref={fbRef}
            style={fbCols ? { gridTemplateColumns: fbCols } : undefined}
          >
            <FileTree nodes={tree} onOpen={openFile} onRefresh={refreshTree} onSelectDir={setSelectedDir} onCreate={handleCreate} />
            {/* 内部分隔条：拖动调整目录树 / 文件列表宽度 */}
            <div className="fb-handle" {...fbHandle} />
            <FileList nodes={tree} selectedDir={selectedDir} onOpen={openFile} dragActive={dragActive} />
          </div>
        </div>

        {/* 预览 panel：文件预览 / 命令预览 */}
        <div
          className={`fw-panel${!isFiles ? ' is-active' : ''}`}
          data-fw="preview"
        >
          {activeCmd
            ? <CommandPreview cmd={activeCmd} />
            : <Preview projectId={projectId} activeFile={isFiles || isCmd ? null : activeFileKey} />}
        </div>
      </div>
    </div>
  )
}
