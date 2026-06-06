import { buildDiff } from './diff'
import { useElapsed } from './dumb/elapsed'
import { DiffLine } from './dumb/DiffLine'
import { displayPath } from './dumb/displayPath'

export type OpKind = 'read' | 'bash' | 'edit' | 'write' | 'todo' | 'skill'

// Re-export dumb atoms so existing consumers that import from './OpCard' keep working.
export { useElapsed } from './dumb/elapsed'
export { DiffLine } from './dumb/DiffLine'

export function kindOf(name: string): OpKind {
  if (name === 'Skill') return 'skill'
  if (name === 'Write') return 'write'
  if (/^(Edit|MultiEdit)$/.test(name)) return 'edit'
  if (name === 'Bash') return 'bash'
  if (name === 'TodoWrite') return 'todo'
  return 'read'
}

interface OpCardProps {
  name: string
  /** 切片归一的中立工具种类；提供时优先于 kindOf(name)（使 codex shell 命令正确渲成「运行命令」）。 */
  tool?: OpKind
  input: unknown
  result?: { ok: boolean; content: string } | null
  startedAt?: number
  completedAt?: number
  projectRoot?: string
  /** bash/read 卡点击：在右侧预览开命令 tab。 */
  onOpen?: () => void
  /** 编辑卡点击：在左侧会话浮层看完整 diff（Issue 21）。 */
  onOpenDiff?: (d: { filePath: string; oldStr: string; newStr: string }) => void
}

// 编辑卡折叠阈值：超过这些行只显示前 N 行 + 「点击看全」（与 IN/OUT 一致，最多 3 行）。
const DIFF_COLLAPSE_ROWS = 3

export function OpCard({ name, tool, input, result, startedAt, completedAt, projectRoot, onOpen, onOpenDiff }: OpCardProps) {
  const kind = tool ?? kindOf(name)
  const inp = input as Record<string, unknown>
  const elapsed = useElapsed(startedAt, completedAt)

  if (kind === 'read') {
    const filePath = (inp.file_path ?? inp.path ?? '') as string
    return (
      <div className={`op-row${onOpen ? ' is-clickable' : ''}`} onClick={onOpen} title={onOpen ? '点击在右侧查看读取内容' : undefined}>
        <div className="op-line">
          <span className="opl-name">读取</span>
          {filePath && <span className="opl-path" title={filePath}>{displayPath(filePath, projectRoot)}</span>}
          {elapsed && <span className="opl-t">{elapsed}</span>}
        </div>
      </div>
    )
  }

  if (kind === 'bash') {
    const command = (inp.command ?? '') as string
    const desc = typeof inp.description === 'string' ? inp.description.trim() : ''
    return (
      <div className={`op-row${onOpen ? ' is-clickable' : ''}`} onClick={onOpen} title={onOpen ? '点击在右侧查看完整命令与输出' : undefined}>
        <div className="op-line">
          <span className="opl-name">运行命令</span>
          {desc && <span className="opl-desc" title={desc}>{desc}</span>}
          {elapsed && <span className="opl-t">{elapsed}</span>}
        </div>
        {(command || (result && result.content)) && (
          <div className="op-io">
            {command && (
              <div className="io-row"><span className="io-tag">IN</span><pre className="io-code">{command}</pre></div>
            )}
            {result && result.content && (
              <div className="io-row"><span className="io-tag">OUT</span><pre className="io-code">{result.content}</pre></div>
            )}
          </div>
        )}
      </div>
    )
  }

  if (kind === 'write') {
    const filePath = (inp.file_path ?? inp.path ?? '') as string
    const content = (inp.content ?? '') as string
    const lineCount = content ? content.split('\n').length : 0
    return (
      <div className="op-row">
        <div className="op-line">
          <span className="opl-name">写入</span>
          {filePath && <span className="opl-path" title={filePath}>{displayPath(filePath, projectRoot)}</span>}
          {elapsed && <span className="opl-t">{elapsed}</span>}
        </div>
        {lineCount > 0 && <div className="op-meta">{lineCount} 行</div>}
        {content && <div className="op-file"><pre>{content}</pre></div>}
      </div>
    )
  }

  if (kind === 'edit') {
    const filePath = (inp.file_path ?? inp.path ?? '') as string
    const oldStr = (inp.old_string ?? '') as string
    const newStr = (inp.new_string ?? '') as string
    const diff = buildDiff(oldStr, newStr)
    const collapsed = diff.rows.length > DIFF_COLLAPSE_ROWS
    const shownRows = collapsed ? diff.rows.slice(0, DIFF_COLLAPSE_ROWS) : diff.rows
    const openFull = onOpenDiff ? () => onOpenDiff({ filePath, oldStr, newStr }) : undefined
    return (
      <div className={`op-row${openFull ? ' is-clickable' : ''}`} onClick={openFull} title={openFull ? '点击查看完整改动' : undefined}>
        <div className="op-line">
          <span className="opl-name">编辑</span>
          {filePath && <span className="opl-path" title={filePath}>{displayPath(filePath, projectRoot)}</span>}
          {elapsed && <span className="opl-t">{elapsed}</span>}
        </div>
        {diff.rows.length > 0 && <div className="op-meta">+{diff.added} −{diff.removed} 行</div>}
        {diff.rows.length > 0 && (
          <pre className="op-diff vscode">
            {shownRows.map((row, i) => <DiffLine key={i} row={row} />)}
          </pre>
        )}
        {collapsed && (
          <div className="op-diff-more">+{diff.added} −{diff.removed} · 点击查看完整改动（共 {diff.rows.length} 行）</div>
        )}
      </div>
    )
  }

  // 'skill' 由 BlocksView 改用 SkillRow 渲染；'todo' 由 TodoCard 渲染 —— 都不会走到这里
  return null
}
