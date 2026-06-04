/**
 * FileList.tsx — 文件浏览器右侧「文件列表」面板（Issue 16 重构）
 *
 * 显示「当前选中文件夹」下的文件（selectedDir，''=项目根）：
 *   - 选中夹下有子文件夹 → 一级按子文件夹分组，子文件夹内再按文件类型分组（次级）；
 *     选中夹根下的直接文件单独成「（当前目录）」组；
 *   - 无子文件夹 → 平铺按文件类型分组。
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

// 递归收集某子树下的所有文件（用于子文件夹分组：把该子文件夹下深层文件都纳入）。
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

function FileRow({ file, onOpen }: { file: FileNode; onOpen: (p: string) => void }) {
  const { type, tag, cssClass } = fileTypeLabel(file.name)
  return (
    <div className="fb-row" onClick={() => onOpen(file.path)}>
      <span className="fb-col-check"><span className="fb-check" /></span>
      <span className="fb-col-name">
        <span className={`fb-icon${cssClass ? ' ' + cssClass : ''}`}>{tag}</span>
        <span className="fb-meta"><b>{file.name}</b><i /></span>
      </span>
      <span className="fb-col-type">{type}</span>
      <span className="fb-col-time">—</span>
    </div>
  )
}

// 一组文件按类型渲染（次级分组）。
function TypeGroups({ files, onOpen }: { files: FileNode[]; onOpen: (p: string) => void }) {
  const grouped = groupByType(files)
  return (
    <>
      {Array.from(grouped.entries()).map(([typeName, fs]) => (
        <div key={typeName}>
          <div className="fb-group">{typeName} <span className="cnt">{fs.length}</span></div>
          {fs.map((f) => <FileRow key={f.path} file={f} onOpen={onOpen} />)}
        </div>
      ))}
    </>
  )
}

// ── FileList 组件 ──────────────────────────────────────────────────────────────

interface FileListProps {
  nodes: FileNode[]
  /** 当前选中目录（''=项目根），右侧列表据此联动（Issue 16）。 */
  selectedDir: string
  onOpen: (path: string) => void
  /** 拖放进行中：放置区高亮（拖放热区在父面板 FileWorkspace 上） */
  dragActive?: boolean
}

export function FileList({ nodes, selectedDir, onOpen, dragActive = false }: FileListProps) {
  const children = childrenOf(nodes, selectedDir)
  const subDirs = children.filter((n) => n.type === 'dir')
  const directFiles = children.filter((n) => n.type === 'file')
  const hasSubdirs = subDirs.length > 0

  return (
    <div className="fb-main">
      <div className="fb-head">
        <span className="fb-col-check"><span className="fb-check" /></span>
        <span className="fb-col-name">名称</span>
        <span className="fb-col-type">类型</span>
        <span className="fb-col-time">修改时间 ↓</span>
      </div>

      {hasSubdirs ? (
        <>
          {/* 当前目录直接文件（不在任何子文件夹里）单独成组 */}
          {directFiles.length > 0 && (
            <div className="fb-folder-sec">
              <div className="fb-folder-h">（当前目录） <span className="cnt">{directFiles.length}</span></div>
              <TypeGroups files={directFiles} onOpen={onOpen} />
            </div>
          )}
          {/* 一级按子文件夹分组：每个子文件夹下深层文件，再按类型（次级）分组 */}
          {subDirs.map((dir) => {
            const files = collectFiles(dir.children ?? [])
            return (
              <div key={dir.path} className="fb-folder-sec">
                <div className="fb-folder-h">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
                  </svg>
                  {dir.name} <span className="cnt">{files.length}</span>
                </div>
                {files.length > 0 ? <TypeGroups files={files} onOpen={onOpen} /> : <div className="fb-folder-empty">（空文件夹）</div>}
              </div>
            )
          })}
        </>
      ) : (
        <TypeGroups files={directFiles} onOpen={onOpen} />
      )}

      <div className={`fb-dropzone${dragActive ? ' is-dragover' : ''}`}>
        <div className="fb-dz-title">↧ 把文件拖到这里</div>
        <div className="fb-dz-sub">图片、文档、参考资料或文件夹 — 拖入即复制进当前项目。</div>
      </div>
    </div>
  )
}
