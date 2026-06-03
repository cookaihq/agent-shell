import fs from 'node:fs'
import path from 'node:path'

export interface FileNode { name: string; path: string; type: 'file' | 'dir'; children?: FileNode[] }
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
      count++
      const childRel = rel ? `${rel}/${e.name}` : e.name
      if (e.isDirectory()) nodes.push({ name: e.name, path: childRel, type: 'dir', children: walk(path.join(dir, e.name), childRel, depth + 1) })
      else if (e.isFile()) nodes.push({ name: e.name, path: childRel, type: 'file' })
    }
    return nodes
  }
  return walk(root, '', 0)
}

export class FileAccessError extends Error {
  constructor(public reason: 'out_of_bounds' | 'not_found' | 'not_a_file') { super(reason) }
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

export function importFiles(root: string, srcPaths: string[]): ImportResult[] {
  const rootResolved = path.resolve(root)
  const imported: ImportResult[] = []
  for (const src of srcPaths) {
    const srcResolved = path.resolve(src)
    // 跳过不存在
    if (!fs.existsSync(srcResolved)) continue
    // 跳过已在项目内的路径（含项目根自身），避免拷进自身
    if (srcResolved === rootResolved || srcResolved.startsWith(rootResolved + path.sep)) continue
    const destName = uniqueDestName(rootResolved, path.basename(srcResolved))
    const dest = path.join(rootResolved, destName)
    fs.cpSync(srcResolved, dest, { recursive: true })
    imported.push({ name: destName, from: srcResolved })
  }
  return imported
}
export interface ReadResult { content: string; truncated: boolean }
export function readProjectFile(root: string, relPath: string, maxBytes = 1_000_000): ReadResult {
  const rootResolved = path.resolve(root), resolved = path.resolve(rootResolved, relPath)
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) throw new FileAccessError('out_of_bounds')
  let stat: fs.Stats
  try { stat = fs.statSync(resolved) } catch { throw new FileAccessError('not_found') }
  if (!stat.isFile()) throw new FileAccessError('not_a_file')
  const buf = fs.readFileSync(resolved)
  return { content: buf.subarray(0, maxBytes).toString('utf8'), truncated: buf.length > maxBytes }
}
