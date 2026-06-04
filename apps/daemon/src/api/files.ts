import fs from 'node:fs'
import path from 'node:path'

export interface FileNode { name: string; path: string; type: 'file' | 'dir'; symlink?: boolean; children?: FileNode[] }
const IGNORED = new Set(['node_modules', '.git', 'dist', '.DS_Store', '.agent-shell', '.next', 'target'])

export function scanTree(root: string, opts: { maxDepth?: number; maxNodes?: number } = {}): FileNode[] {
  const maxDepth = opts.maxDepth ?? 6, maxNodes = opts.maxNodes ?? 2000
  let count = 0
  function walk(dir: string, rel: string, depth: number): FileNode[] {
    if (depth > maxDepth) return []
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return [] }
    entries.sort((a, b) => { const ad = a.isDirectory() ? 0 : 1, bd = b.isDirectory() ? 0 : 1; return ad !== bd ? ad - bd : a.name.localeCompare(b.name) })
    const nodes: FileNode[] = []
    for (const e of entries) {
      if (IGNORED.has(e.name)) continue
      if (count >= maxNodes) break
      // 软链接条目自身既非 dir 也非 file（isDirectory/isFile 均 false），需跟随解析目标真实类型。
      // 技能注入把技能软链进 .claude/skills/，不解析就会被静默丢弃 → 目录显示为空。
      let isDir = e.isDirectory(), isFile = e.isFile()
      const symlink = e.isSymbolicLink()
      if (symlink) {
        try { const st = fs.statSync(path.join(dir, e.name)); isDir = st.isDirectory(); isFile = st.isFile() } catch { continue } // 悬空软链接：跳过
      }
      if (!isDir && !isFile) continue
      count++
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (isDir) nodes.push({ name: e.name, path: childRel, type: 'dir', ...(symlink && { symlink: true }), children: walk(path.join(dir, e.name), childRel, depth + 1) })
      else nodes.push({ name: e.name, path: childRel, type: 'file', ...(symlink && { symlink: true }) })
    }
    return nodes
  }
  return walk(root, '', 0)
}

export class FileAccessError extends Error {
  constructor(public reason: 'out_of_bounds' | 'not_found' | 'not_a_file' | 'already_exists') { super(reason) }
}

// 在项目内新建空文件 / 目录（Issue 15）。relPath 相对项目根；越界（逃出项目根）拒绝；已存在拒绝。
export function createEntry(root: string, relPath: string, kind: 'file' | 'dir'): string {
  const rootResolved = path.resolve(root)
  const resolved = path.resolve(rootResolved, relPath)
  if (resolved === rootResolved || !resolved.startsWith(rootResolved + path.sep)) throw new FileAccessError('out_of_bounds')
  if (fs.existsSync(resolved)) throw new FileAccessError('already_exists')
  if (kind === 'dir') {
    fs.mkdirSync(resolved, { recursive: true })
  } else {
    fs.mkdirSync(path.dirname(resolved), { recursive: true })
    fs.writeFileSync(resolved, '')
  }
  return resolved
}

// ── 拖入文件/文件夹 → 复制进项目根 ──────────────────────────────────────────────
// 取一组源绝对路径，逐个 cp 进项目根目录。同名时加后缀 `name (1).ext` 保留两份（不覆盖）。
// 跳过：不存在的路径、已在项目内的路径（避免拷进自身造成递归）。

export interface ImportResult { name: string; from: string }

/** 在 dir 下为 srcName 找一个不冲突的目标名：foo.txt → foo (1).txt → foo (2).txt …（无扩展名/文件夹同理）。 */
function uniqueDestName(dir: string, srcName: string): string {
  if (!fs.existsSync(path.join(dir, srcName))) return srcName
  const ext = path.extname(srcName)               // '.txt'（含点）或 ''
  const base = ext ? srcName.slice(0, -ext.length) : srcName
  for (let i = 1; ; i++) {
    const candidate = `${base} (${i})${ext}`
    if (!fs.existsSync(path.join(dir, candidate))) return candidate
  }
}

// dir：可选子目录（如 'attachments'）。空=落项目根（拖入文件面板）；非空=落 <root>/<dir>/（消息附件），自动建夹。
export function importFiles(root: string, srcPaths: string[], dir = ''): ImportResult[] {
  const rootResolved = path.resolve(root)
  const destDir = dir ? path.join(rootResolved, dir) : rootResolved
  const imported: ImportResult[] = []
  for (const src of srcPaths) {
    const srcResolved = path.resolve(src)
    // 跳过不存在
    if (!fs.existsSync(srcResolved)) continue
    // 跳过已在项目内的路径（含项目根自身），避免拷进自身
    if (srcResolved === rootResolved || srcResolved.startsWith(rootResolved + path.sep)) continue
    if (dir) fs.mkdirSync(destDir, { recursive: true })   // 子目录按需建
    const destName = uniqueDestName(destDir, path.basename(srcResolved))
    const dest = path.join(destDir, destName)
    fs.cpSync(srcResolved, dest, { recursive: true })
    imported.push({ name: destName, from: srcResolved })
  }
  return imported
}
// ── 粘贴字节写盘（剪贴板内容无源路径，只能写进项目）─────────────────────────────
// 把一段字节写进 <root>/<dir>/，自动建夹、同名去重；返回相对 posix 路径 + 大小。
export interface SaveResult { name: string; path: string; size: number }
export function saveAttachmentBytes(root: string, dir: string, name: string, data: Buffer): SaveResult {
  const destDir = path.join(path.resolve(root), dir)
  fs.mkdirSync(destDir, { recursive: true })
  const destName = uniqueDestName(destDir, name)
  fs.writeFileSync(path.join(destDir, destName), data)
  return { name: destName, path: `${dir}/${destName}`, size: data.length }
}

// 把项目内相对路径解析为安全的磁盘绝对路径（越界/存在/是文件三重校验）。
// 供「在外部程序打开」用：renderer 自己不拼路径，统一复用此处的越界校验。
export function resolveProjectFile(root: string, relPath: string): string {
  const rootResolved = path.resolve(root), resolved = path.resolve(rootResolved, relPath)
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) throw new FileAccessError('out_of_bounds')
  let stat: fs.Stats
  try { stat = fs.statSync(resolved) } catch { throw new FileAccessError('not_found') }
  if (!stat.isFile()) throw new FileAccessError('not_a_file')
  return resolved
}

export interface ReadResult { content: string; truncated: boolean }
export function readProjectFile(root: string, relPath: string, maxBytes = 1_000_000): ReadResult {
  const resolved = resolveProjectFile(root, relPath)
  const buf = fs.readFileSync(resolved)
  return { content: buf.subarray(0, maxBytes).toString('utf8'), truncated: buf.length > maxBytes }
}
