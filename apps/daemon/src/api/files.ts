import fs from 'node:fs'
import path from 'node:path'

export interface FileNode { name: string; path: string; type: 'file' | 'dir'; symlink?: boolean; mtimeMs?: number; birthtimeMs?: number; children?: FileNode[] }
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
      // 每条目读 stat 取修改/创建时间（Issue 10，列表视图两列真数据）；软链顺带跟随解析目标真实类型。
      let mtimeMs: number | undefined, birthtimeMs: number | undefined
      try {
        const st = fs.statSync(path.join(dir, e.name))
        mtimeMs = st.mtimeMs; birthtimeMs = st.birthtimeMs
        if (symlink) { isDir = st.isDirectory(); isFile = st.isFile() }
      } catch {
        if (symlink) continue   // 悬空软链接：跳过；非软链 stat 失败则无时间字段、仍正常列出
      }
      if (!isDir && !isFile) continue
      count++
      const childRel = rel ? `${rel}/${e.name}` : e.name
      const time = { ...(mtimeMs !== undefined && { mtimeMs }), ...(birthtimeMs !== undefined && { birthtimeMs }) }
      if (isDir) nodes.push({ name: e.name, path: childRel, type: 'dir', ...(symlink && { symlink: true }), ...time, children: walk(path.join(dir, e.name), childRel, depth + 1) })
      else nodes.push({ name: e.name, path: childRel, type: 'file', ...(symlink && { symlink: true }), ...time })
    }
    return nodes
  }
  return walk(root, '', 0)
}

export class FileAccessError extends Error {
  constructor(public reason: 'out_of_bounds' | 'not_found' | 'not_a_file' | 'already_exists' | 'invalid_name' | 'invalid_move') { super(reason) }
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

// 两个磁盘路径是否指向同一文件（同 inode）。用于大小写不敏感文件系统上区分「仅改大小写」与真冲突。
function sameInode(a: string, b: string): boolean {
  try { return fs.statSync(a).ino === fs.statSync(b).ino } catch { return false }
}

// 同目录改名（文件或目录均可）。newName 不得含路径分隔符 / 不得为 . 或 ..；越界、源不存在、目标重名均拒绝。
// 返回改名后的项目内相对 posix 路径。
export function renameEntry(root: string, relPath: string, newName: string): string {
  if (!newName || newName.includes('/') || newName.includes('\\') || newName === '.' || newName === '..') {
    throw new FileAccessError('invalid_name')
  }
  const rootResolved = path.resolve(root)
  const src = path.resolve(rootResolved, relPath)
  if (src === rootResolved || !src.startsWith(rootResolved + path.sep)) throw new FileAccessError('out_of_bounds')
  if (!fs.existsSync(src)) throw new FileAccessError('not_found')
  const dest = path.join(path.dirname(src), newName)
  // 目标已存在即拒绝；但大小写不敏感文件系统（macOS APFS 默认）上「仅改大小写」时 dest 会命中源自身，需放行。
  if (dest !== src && fs.existsSync(dest) && !sameInode(dest, src)) throw new FileAccessError('already_exists')
  fs.renameSync(src, dest)
  return path.relative(rootResolved, dest).split(path.sep).join('/')
}

// 把若干源移动到项目内目标目录（destDirRel，''=项目根）。同名冲突走 uniqueDestName 不覆盖；
// 跳过：越界 / 不存在 / 已在目标目录中（no-op）的源。禁止把目录移进自身或其子孙（抛 invalid_move）。
// 同设备 renameSync；跨设备（EXDEV）回退 cpSync + rmSync。返回每项的新旧相对 posix 路径。
export interface MoveResult { from: string; to: string }
export function moveEntry(root: string, srcRelPaths: string[], destDirRel: string): MoveResult[] {
  const rootResolved = path.resolve(root)
  const destDir = path.resolve(rootResolved, destDirRel)
  if (destDir !== rootResolved && !destDir.startsWith(rootResolved + path.sep)) throw new FileAccessError('out_of_bounds')
  let dstat: fs.Stats
  try { dstat = fs.statSync(destDir) } catch { throw new FileAccessError('not_found') }
  if (!dstat.isDirectory()) throw new FileAccessError('invalid_move')   // 目标不是目录
  const moved: MoveResult[] = []
  for (const rel of srcRelPaths) {
    const src = path.resolve(rootResolved, rel)
    if (src === rootResolved || !src.startsWith(rootResolved + path.sep)) continue   // 越界 / 根：跳过
    if (!fs.existsSync(src)) continue                                                // 不存在：跳过
    if (path.dirname(src) === destDir) continue                                      // 已在目标目录：no-op
    // 禁止把目录移进自身或其子孙（防递归自吞）
    if (fs.statSync(src).isDirectory() && (destDir === src || destDir.startsWith(src + path.sep))) {
      throw new FileAccessError('invalid_move')
    }
    const destName = uniqueDestName(destDir, path.basename(src))
    const dest = path.join(destDir, destName)
    try {
      fs.renameSync(src, dest)
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === 'EXDEV') { fs.cpSync(src, dest, { recursive: true }); fs.rmSync(src, { recursive: true, force: true }) }
      else throw e
    }
    moved.push({ from: rel, to: path.relative(rootResolved, dest).split(path.sep).join('/') })
  }
  return moved
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

// 把项目内相对路径解析为安全磁盘绝对路径（越界 + 存在校验，但不限定是文件——目录也放行）。
// 供「复制绝对路径 / 在 Finder 中显示」用：文件夹也要能取绝对路径（resolveProjectFile 会对目录抛 not_a_file）。
export function resolveProjectPath(root: string, relPath: string): string {
  const rootResolved = path.resolve(root), resolved = path.resolve(rootResolved, relPath)
  if (resolved !== rootResolved && !resolved.startsWith(rootResolved + path.sep)) throw new FileAccessError('out_of_bounds')
  if (!fs.existsSync(resolved)) throw new FileAccessError('not_found')
  return resolved
}

export interface ReadResult { content: string; truncated: boolean }
export function readProjectFile(root: string, relPath: string, maxBytes = 1_000_000): ReadResult {
  const resolved = resolveProjectFile(root, relPath)
  const buf = fs.readFileSync(resolved)
  return { content: buf.subarray(0, maxBytes).toString('utf8'), truncated: buf.length > maxBytes }
}
