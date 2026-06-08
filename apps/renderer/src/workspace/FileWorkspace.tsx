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
import type { AgentShellBridge, EditorEntry, Engine } from '@agent-shell/contracts'
import { api, ApiError } from '../api/client'
import { useSplitDrag } from '../hooks/useSplitDrag'
import { useFsWatch } from '../hooks/useFsWatch'
import { FileTree } from './FileTree'
import { FileList } from './FileList'
import { ContextMenu, type MenuItem } from '../ui/ContextMenu'
import { Preview } from './Preview'
import { CommandPreview } from './CommandPreview'
import type { OpenCommand } from './ChatLog'
import { getSlice } from './agents/registry'
import type { FileNode, Block } from '../api/types'

const CMD_PREFIX = 'cmd:'
// 内部拖拽标记：区分「拖项目内文件/夹去移动」与「拖系统文件进面板=导入」。仅同机同窗，dataTransfer 带此 MIME 即内部移动。
const INTERNAL_DRAG_MIME = 'application/x-agent-shell-paths'

// 桌面壳桥（window.agentShell）；浏览器/dev 下为 undefined。OS 集成项（废纸篓/Finder/默认程序）据此禁用。
function getBridge(): AgentShellBridge | undefined {
  return (globalThis as { agentShell?: AgentShellBridge }).agentShell
}

// 编辑器检测结果 app 运行期缓存：装没装与项目无关，切项目 tab 不重测；重启 app 才重测。
let editorsCache: EditorEntry[] | null = null

// 从拖放事件取一组源磁盘绝对路径。Electron 32+ 已移除 File.path，统一经 preload 的 webUtils.getPathForFile。
// 浏览器/dev（无 agentShell 桥）下返回空数组 → 不导入（拖放是桌面壳能力）。
function pathsFromDrop(e: React.DragEvent): string[] {
  const bridge = getBridge()
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
  /** 点击会话附件 chip 的请求（seq 变化即触发在预览打开该文件）。 */
  openFileReq?: { path: string; seq: number } | null
  /** 当前会话引擎：取切片 rightViews 槽渲染形态 B 面板（spec §6）。缺省 'claude'。 */
  engine?: Engine
  /** 切片私有累计态（chatReducer.sliceState，外壳不解释）：透传给切片 rightViews 渲染右栏面板。 */
  sliceState?: unknown
  /** 全部消息块（messages 扁平 + liveBlocks）：透传给切片，按 parentToolUseId 分组成各子代理卡片的迷你时间线。 */
  blocks?: Block[]
  /** header 头像入口点击信号（seq 变化 → 右侧切 agents 视图，形态 C→B 联动）。 */
  showAgentsReq?: { seq: number } | null
  /** 子代理卡片内工具行点击 → 右侧开命令/文件详情 tab（复用 Workspace 的 onOpenCommand）。 */
  onOpenCommand?: (cmd: OpenCommand) => void
  /** 项目根绝对路径（卡片内 OpCard 路径精简用）。 */
  projectRoot?: string
}

export function FileWorkspace({ projectId, onActiveFile, openCmd, openFileReq, engine = 'claude', sliceState, blocks, showAgentsReq, onOpenCommand, projectRoot }: FileWorkspaceProps) {
  const [tree, setTree] = useState<FileNode[]>([])
  const [editors, setEditors] = useState<EditorEntry[]>(editorsCache ?? [])
  const requestEditors = async () => {
    if (editorsCache) { setEditors(editorsCache); return }
    const bridge = getBridge()
    if (!bridge?.detectEditors) return
    try {
      const list = await bridge.detectEditors()
      editorsCache = list
      setEditors(list)
    } catch { /* 静默：检测失败则不显示编辑器项 */ }
  }
  const openInEditor = (id: string) => {
    const bridge = getBridge()
    if (!bridge?.openInEditor || !projectRoot) return
    void bridge.openInEditor(id, projectRoot)
  }
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
  // 右侧视图轴：'file'（文件浏览/预览/命令，由 activeFileKey 决定）| 切片视图槽 id（如 'agents' 形态 B 面板）。
  const [rightView, setRightView] = useState<string>('file')
  // 任何文件交互（activeFileKey 变）→ 回到 file 视图（切片视图不改 activeFileKey，故不会被误切）。
  useEffect(() => { setRightView('file') }, [activeFileKey])
  // header 头像入口点击（形态 C）→ 切切片视图（形态 B，约定切到首个有内容的切片视图槽）。
  useEffect(() => { if (showAgentsReq && sliceViews[0]) setRightView(sliceViews[0].id) }, [showAgentsReq?.seq])
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

  // ── 右键菜单（受控浮层，状态/构造/回调统一在容器，子组件只上报上下文，§5.1）──────────
  const [menu, setMenu] = useState<{ x: number; y: number; items: MenuItem[] } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  // 内联重命名：哪一项、来自树还是列表（按 source 分发 RenameInput，避免树/列表同 path 双输入框）
  const [renaming, setRenaming] = useState<{ path: string; source: 'tree' | 'list' } | null>(null)
  // 轻量 toast（删除部分失败 / 重命名报错提示）
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = useCallback((msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2600)
  }, [])
  // 右键文件夹「在此新建」：先把落点设为该文件夹，再用信号让 FileTree 进入内联新建态（落点由 handleCreate 读 selectedDir）
  const [createReq, setCreateReq] = useState<{ kind: 'file' | 'dir'; seq: number } | null>(null)
  const createSeqRef = useRef(0)
  const startCreateIn = (dir: string, kind: 'file' | 'dir') => { setSelectedDir(dir); setCreateReq({ kind, seq: ++createSeqRef.current }) }

  // OS 集成操作：均先经 daemon abs-path（带越界校验）解析绝对路径，再交 bridge；renderer 不自拼路径。
  const copyAbsPath = useCallback(async (p: string) => {
    try { const { absPath } = await api.absPath(projectId, p); await navigator.clipboard.writeText(absPath) } catch { /* 静默 */ }
  }, [projectId])
  const openInDefaultApp = useCallback(async (p: string) => {
    const bridge = getBridge(); if (!bridge) return
    try { const { absPath } = await api.absPath(projectId, p); await bridge.openPath(absPath) } catch { /* 静默 */ }
  }, [projectId])
  const showInFinder = useCallback(async (p: string) => {
    const bridge = getBridge(); if (!bridge) return
    try { const { absPath } = await api.absPath(projectId, p); await bridge.showItemInFolder(absPath) } catch { /* 静默 */ }
  }, [projectId])
  // 导入到指定子目录（''=项目根）：弹原生选择器 → importFiles → 刷新树
  const importTo = useCallback(async (dir: string) => {
    const bridge = getBridge(); if (!bridge) return
    try {
      const paths = await bridge.pickPaths()
      if (!paths.length) return
      const { tree: t } = await api.importFiles(projectId, paths, dir)
      setTree(t)
    } catch { /* 静默 */ }
  }, [projectId])

  // 路径变更（重命名/移动）后同步已打开 tab 的 key：文件精确映射、文件夹按前缀映射；activeFileKey 同步。
  const remapTabs = useCallback((from: string, to: string) => {
    const map = (p: string) => (p === from ? to : p.startsWith(from + '/') ? to + p.slice(from.length) : p)
    setOpenTabs((prev) => prev.map(map))
    setActiveFileKey((cur) => (cur === 'files' || cur.startsWith(CMD_PREFIX) ? cur : map(cur)))
  }, [])
  // 删除后关闭命中的 tab（文件精确 / 文件夹前缀）；命中 active → 回 'files'。
  const dropTabs = useCallback((paths: string[]) => {
    const hit = (p: string) => paths.some((d) => p === d || p.startsWith(d + '/'))
    setOpenTabs((prev) => prev.filter((p) => !hit(p)))
    setActiveFileKey((cur) => (cur !== 'files' && !cur.startsWith(CMD_PREFIX) && hit(cur) ? 'files' : cur))
  }, [])

  // 重命名：调 daemon → 即时 setTree（SSE 也会刷新）→ 同步 tab；失败弹 toast。
  const doRename = useCallback(async (path: string, newName: string) => {
    setRenaming(null)
    try {
      const { path: newPath, tree: t } = await api.rename(projectId, path, newName)
      setTree(t)
      remapTabs(path, newPath)
    } catch (e) {
      showToast(e instanceof ApiError && e.code === 'already_exists' ? '同名文件/目录已存在' : '重命名失败')
    }
  }, [projectId, remapTabs, showToast])

  // 删除（移废纸篓）：逐个解析绝对路径 → bridge.trashItem → 关 tab；树靠现有 SSE 监听自动刷新（不手动刷新，§8）。
  const doDelete = useCallback(async (paths: string[]) => {
    const bridge = getBridge()
    if (!bridge || !paths.length) return
    const abs: string[] = []
    for (const p of paths) {
      try { const r = await api.absPath(projectId, p); abs.push(r.absPath) } catch { /* 解析失败：跳过该项 */ }
    }
    if (!abs.length) { showToast('删除失败'); return }
    const { failed } = await bridge.trashItem(abs)
    dropTabs(paths)
    if (failed.length) showToast(`有 ${failed.length} 项未能移到废纸篓`)
  }, [projectId, dropTabs, showToast])

  // ── 内部拖拽移动（拖项目内文件/夹到树的文件夹节点；与「拖系统文件进面板=导入」区分，§5.6）──
  // 拖拽组用 ref 持有（同窗拖拽，dragOver 阶段读不到 dataTransfer.getData，故 self/子孙校验靠 ref）；
  // dataTransfer 仍写自定义 MIME，供「内部 vs 外部」判别。
  const dragPathsRef = useRef<string[]>([])
  const beginInternalDrag = useCallback((paths: string[], e: React.DragEvent) => {
    dragPathsRef.current = paths
    try { e.dataTransfer.setData(INTERNAL_DRAG_MIME, paths.join('\n')); e.dataTransfer.effectAllowed = 'move' } catch { /* */ }
  }, [])
  // 能否把当前拖拽组放进 destDir：禁止把目录放进自身或其子孙（daemon 也校验，§6.2）
  const canDropInto = useCallback((destDir: string) => {
    const ps = dragPathsRef.current
    return ps.length > 0 && !ps.some((p) => destDir === p || destDir.startsWith(p + '/'))
  }, [])
  const dropMoveInto = useCallback(async (destDir: string, e: React.DragEvent) => {
    e.preventDefault()
    const ps = dragPathsRef.current
    dragPathsRef.current = []
    if (!ps.length || ps.some((p) => destDir === p || destDir.startsWith(p + '/'))) return   // 非法/空：忽略
    try {
      const { moved, tree: t } = await api.move(projectId, ps, destDir)
      setTree(t)
      for (const m of moved) remapTabs(m.from, m.to)   // 移动后同步已打开 tab 的 key
    } catch { showToast('移动失败') }
  }, [projectId, remapTabs, showToast])

  // 右键文件（树/列表/画廊通用，单选）的菜单项。source 决定内联重命名落在树还是列表。
  const fileMenuItems = (path: string, source: 'tree' | 'list', bridge: AgentShellBridge | undefined): MenuItem[] => [
    { label: '打开', onClick: () => openFile(path) },
    { label: '用默认程序打开', disabled: !bridge, onClick: () => openInDefaultApp(path) },
    { label: '在 Finder 中显示', disabled: !bridge, onClick: () => showInFinder(path) },
    { separator: true },
    { label: '重命名', onClick: () => setRenaming({ path, source }) },
    { label: '复制绝对路径', onClick: () => copyAbsPath(path) },
    { separator: true },
    { label: '删除（移废纸篓）', danger: true, disabled: !bridge, onClick: () => doDelete([path]) },
  ]

  // 右键树节点 / 树空白 → 构造菜单（树保持单选，node 即命中的单个节点）。
  const onTreeContext = (node: FileNode | null, e: React.MouseEvent) => {
    const bridge = getBridge()
    let items: MenuItem[]
    if (!node) {
      items = [
        { label: '新建文件', onClick: () => startCreateIn(selectedDir, 'file') },
        { label: '新建文件夹', onClick: () => startCreateIn(selectedDir, 'dir') },
        { label: '导入文件', disabled: !bridge, onClick: () => importTo(selectedDir) },
        { separator: true },
        { label: '刷新', onClick: refreshTree },
      ]
    } else if (node.type === 'dir') {
      items = [
        { label: '在此新建文件', onClick: () => startCreateIn(node.path, 'file') },
        { label: '在此新建文件夹', onClick: () => startCreateIn(node.path, 'dir') },
        { label: '导入文件到这里', disabled: !bridge, onClick: () => importTo(node.path) },
        { separator: true },
        { label: '在 Finder 中打开', disabled: !bridge, onClick: () => showInFinder(node.path) },
        { label: '重命名', onClick: () => setRenaming({ path: node.path, source: 'tree' }) },
        { label: '复制绝对路径', onClick: () => copyAbsPath(node.path) },
        { separator: true },
        { label: '删除（移废纸篓）', danger: true, disabled: !bridge, onClick: () => doDelete([node.path]) },
      ]
    } else {
      items = fileMenuItems(node.path, 'tree', bridge)
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // 右键文件列表项 / 列表空白 → 构造菜单。多选（targets>1）只保留批量删除（§5.3）；单选用文件全菜单。
  const onListContext = (node: FileNode | null, targets: string[], e: React.MouseEvent) => {
    const bridge = getBridge()
    let items: MenuItem[]
    if (!node) {
      items = [
        { label: '新建文件', onClick: () => startCreateIn(selectedDir, 'file') },
        { label: '新建文件夹', onClick: () => startCreateIn(selectedDir, 'dir') },
        { label: '导入文件', disabled: !bridge, onClick: () => importTo(selectedDir) },
        { separator: true },
        { label: '刷新', onClick: refreshTree },
      ]
    } else if (targets.length > 1) {
      items = [{ label: `删除（移废纸篓 ${targets.length} 项）`, danger: true, disabled: !bridge, onClick: () => doDelete(targets) }]
    } else {
      items = fileMenuItems(node.path, 'list', bridge)
    }
    setMenu({ x: e.clientX, y: e.clientY, items })
  }

  // 会话附件 chip 点击 → 打开文件 tab + 预览（seq 变化触发；与文件树点击共用 openFile）
  useEffect(() => {
    if (!openFileReq) return
    openFile(openFileReq.path)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [openFileReq?.seq])

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

  // 形态 B（spec §6）：右栏视图槽整条由当前会话引擎切片 rightViews 贡献（外壳不读 SubagentMeta）。
  // 外壳只占视图轴：渲染 tab（slot.hasContent 才显示）+ 在右栏 panel 里渲染 slot.render()。codex 会话 → 无槽 → 空。
  const sliceViews = (getSlice(engine).rightViews?.({ sliceState, blocks: blocks ?? [], onOpenCommand, projectRoot, onShowAgents: () => {} }) ?? [])
    .filter((v) => v.hasContent)
  const isSliceView = rightView !== 'file'
  const activeSliceView = isSliceView ? sliceViews.find((v) => v.id === rightView) : undefined
  const showPreviewTab = !isFiles && !isCmd   // 有文件打开时才有「预览」视图

  return (
    <div className="fw" data-testid="file-workspace">
      {/* 标签栏 */}
      <div className="fw-tabs">
        {/* 固定「文件」tab */}
        <button
          className={`fw-ftab${isFiles && !isSliceView ? ' is-active' : ''}`}
          data-ftab="files"
          type="button"
          onClick={() => { setActiveFileKey('files'); setRightView('file') }}
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
                className={`fw-ftab${activeFileKey === path && !isSliceView ? ' is-active' : ''}`}
                data-ftab={path}
                type="button"
                onClick={() => { setActiveFileKey(path); setRightView('file') }}
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
                className={`fw-ftab fw-ftab-cmd${activeFileKey === key && !isSliceView ? ' is-active' : ''}`}
                type="button"
                onClick={() => { setActiveFileKey(key); setRightView('file') }}
              >
                <span className="ftab-label">{label}</span>
                <span className="ftab-x" title="关闭" onClick={(e) => closeTab(key, e)}>×</span>
              </button>
            )
          })}
        </div>

        {/* 视图 tab：切片贡献视图（如 Subagent，形态 B）+ 预览（有文件打开时）。两者皆无 → 整条隐藏。 */}
        <div className="fw-views" style={{ display: sliceViews.length > 0 || showPreviewTab ? '' : 'none' }}>
          {sliceViews.map((v) => (
            <button
              key={v.id}
              className={`fw-tab${rightView === v.id ? ' is-active' : ''}`}
              data-fw={v.id}
              type="button"
              onClick={() => setRightView(v.id)}
            >
              {v.tabLabel}
            </button>
          ))}
          {showPreviewTab && (
            <button
              className={`fw-tab${!isSliceView ? ' is-active' : ''}`}
              data-fw="preview"
              type="button"
              onClick={() => setRightView('file')}
            >
              预览
            </button>
          )}
        </div>
      </div>

      {/* 内容区 */}
      <div className="fw-body">
        {/* 文件浏览器 panel —— 整个面板为拖放热区 */}
        <div
          className={`fw-panel${!isSliceView && isFiles ? ' is-active' : ''}${dragActive ? ' is-dragover' : ''}`}
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
            <FileTree
              nodes={tree}
              onOpen={openFile}
              onRefresh={refreshTree}
              onSelectDir={setSelectedDir}
              onCreate={handleCreate}
              onContext={onTreeContext}
              rename={renaming?.source === 'tree' ? { path: renaming.path, submit: doRename, cancel: () => setRenaming(null) } : undefined}
              createReq={createReq ?? undefined}
              dnd={{ mime: INTERNAL_DRAG_MIME, begin: beginInternalDrag, canDrop: canDropInto, drop: dropMoveInto }}
              editors={getBridge() ? editors : undefined}
              onRequestEditors={requestEditors}
              onOpenInEditor={openInEditor}
            />
            {/* 内部分隔条：拖动调整目录树 / 文件列表宽度 */}
            <div className="fb-handle" {...fbHandle} />
            <FileList
              nodes={tree}
              selectedDir={selectedDir}
              onOpen={openFile}
              projectId={projectId}
              dragActive={dragActive}
              onContext={onListContext}
              rename={renaming?.source === 'list' ? { path: renaming.path, submit: doRename, cancel: () => setRenaming(null) } : undefined}
              onDragStartPaths={beginInternalDrag}
            />
          </div>
        </div>

        {/* 预览 panel：文件预览 / 命令预览 */}
        <div
          className={`fw-panel${!isSliceView && !isFiles ? ' is-active' : ''}`}
          data-fw="preview"
        >
          {activeCmd
            ? <CommandPreview cmd={activeCmd} />
            : <Preview projectId={projectId} activeFile={isFiles || isCmd ? null : activeFileKey} />}
        </div>

        {/* 切片贡献的右栏视图 panel（形态 B·子代理聚合即此）：整块由切片 render() 产出（Gallery/Board 等内部状态归切片）。
            外壳只负责把 active 切片视图的面板挂出来 + data-fw 判别；不读 SubagentMeta。 */}
        {sliceViews.map((v) => (
          <div key={v.id} className={`fw-panel fw-panel-agents${activeSliceView?.id === v.id ? ' is-active' : ''}`} data-fw={v.id}>
            {v.render()}
          </div>
        ))}
      </div>

      {/* 文件浏览器右键菜单（唯一浮层，由容器据上报的上下文构造 items 渲染） */}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menu.items} onClose={closeMenu} />}
      {/* 删除部分失败 / 重命名报错的轻量提示 */}
      {toast && <div className="proj-toast show">{toast}</div>}
    </div>
  )
}
