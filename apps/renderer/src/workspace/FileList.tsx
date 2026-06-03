/**
 * FileList.tsx — Task 20
 *
 * 文件浏览器右侧「文件列表」面板。
 * 高保真对照原型 workspace.html L145-153（.fb-main 结构）。
 *
 * 结构：
 *   .fb-main
 *     > .fb-head（列头：名称/类型/修改时间）
 *     > 按类型分组（.fb-group + .fb-row）
 *     > .fb-dropzone（拖放提示）
 *
 * 当前 activeFileKey 决定显示哪个目录的内容（'files' = 根目录，否则 = 当前选中目录）。
 * 本期简化：始终展示根目录下的直接子节点。
 * 点行 → onOpen(path)。
 */

import type { FileNode } from '../api/types'

// ── 文件类型 → 可读标签 + 短标识 ────────────────────────────────────────────
function fileTypeLabel(name: string): { type: string; tag: string; cssClass: string } {
  const ext = name.split('.').pop()?.toLowerCase() ?? ''
  if (ext === 'html' || ext === 'htm') return { type: 'HTML 页面', tag: '</>', cssClass: '' }
  if (ext === 'css') return { type: '样式表', tag: '#', cssClass: 'css' }
  if (ext === 'md') return { type: 'Markdown', tag: 'M↓', cssClass: '' }
  if (ext === 'json') return { type: 'JSON', tag: '{ }', cssClass: '' }
  if (ext === 'ts') return { type: 'TypeScript', tag: 'TS', cssClass: '' }
  if (ext === 'tsx') return { type: 'TypeScript', tag: 'TS', cssClass: '' }
  if (ext === 'js' || ext === 'jsx') return { type: 'JavaScript', tag: 'JS', cssClass: '' }
  return { type: ext ? ext.toUpperCase() : '文件', tag: '·', cssClass: '' }
}

// ── 从树中提取直接子节点（根目录或选中目录）─────────────────────────────────
function getDisplayNodes(nodes: FileNode[], activeFileKey: string): FileNode[] {
  // 简化：始终展示根目录的直接子节点（文件；文件夹不在列表中）
  return nodes.filter(n => n.type === 'file')
}

// ── 按类型分组 ────────────────────────────────────────────────────────────────
function groupByType(nodes: FileNode[]): Map<string, FileNode[]> {
  const map = new Map<string, FileNode[]>()
  for (const node of nodes) {
    const { type } = fileTypeLabel(node.name)
    if (!map.has(type)) map.set(type, [])
    map.get(type)!.push(node)
  }
  return map
}

// ── FileList 组件 ──────────────────────────────────────────────────────────────

interface FileListProps {
  nodes: FileNode[]
  activeFileKey: string
  onOpen: (path: string) => void
  /** 拖放进行中：放置区高亮（拖放热区在父面板 FileWorkspace 上） */
  dragActive?: boolean
}

export function FileList({ nodes, activeFileKey, onOpen, dragActive = false }: FileListProps) {
  const displayNodes = getDisplayNodes(nodes, activeFileKey)
  const grouped = groupByType(displayNodes)

  return (
    <div className="fb-main">
      <div className="fb-head">
        <span className="fb-col-check"><span className="fb-check" /></span>
        <span className="fb-col-name">名称</span>
        <span className="fb-col-type">类型</span>
        <span className="fb-col-time">修改时间 ↓</span>
      </div>

      {Array.from(grouped.entries()).map(([typeName, files]) => (
        <div key={typeName}>
          <div className="fb-group">
            {typeName} <span className="cnt">{files.length}</span>
          </div>
          {files.map(file => {
            const { type, tag, cssClass } = fileTypeLabel(file.name)
            return (
              <div
                key={file.path}
                className="fb-row"
                onClick={() => onOpen(file.path)}
              >
                <span className="fb-col-check"><span className="fb-check" /></span>
                <span className="fb-col-name">
                  <span className={`fb-icon${cssClass ? ' ' + cssClass : ''}`}>{tag}</span>
                  <span className="fb-meta">
                    <b>{file.name}</b>
                    <i />
                  </span>
                </span>
                <span className="fb-col-type">{type}</span>
                <span className="fb-col-time">—</span>
              </div>
            )
          })}
        </div>
      ))}

      <div className={`fb-dropzone${dragActive ? ' is-dragover' : ''}`}>
        <div className="fb-dz-title">↧ 把文件拖到这里</div>
        <div className="fb-dz-sub">图片、文档、参考资料或文件夹 — 拖入即复制进当前项目。</div>
      </div>
    </div>
  )
}
