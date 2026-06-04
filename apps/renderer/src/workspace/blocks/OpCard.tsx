import { useEffect, useState } from 'react'
import { buildDiff, type DiffRow } from './diff'

export type OpKind = 'read' | 'bash' | 'edit' | 'todo'

/** 运行时长格式化：<1s 显示 ms，否则 s（一位小数）。 */
function fmtDuration(ms: number): string {
  if (ms < 1000) return `${Math.max(0, Math.round(ms))}ms`
  return `${(ms / 1000).toFixed(1)}s`
}

/**
 * 路径显示精简（Issue 9）：
 *  - 项目内文件 → 去掉项目根前缀，显示相对路径（如 attachments/x.pdf）
 *  - 项目外文件 → 能从项目根推断出 home 前缀时缩写为 ~/…，否则原样绝对路径
 * 完整路径仍保留在卡片 title 里（hover 可见）。
 */
function displayPath(filePath: string, projectRoot?: string): string {
  if (!filePath || !projectRoot) return filePath
  const root = projectRoot.replace(/\/+$/, '')
  if (filePath === root) return '.'
  if (filePath.startsWith(root + '/')) return filePath.slice(root.length + 1)
  const home = root.match(/^(\/Users\/[^/]+|\/home\/[^/]+|\/root)(?=\/)/)?.[1]
  if (home && filePath.startsWith(home + '/')) return '~' + filePath.slice(home.length)
  return filePath
}

/** 计时：未完成（无 completedAt）时从 startedAt 实时跳动；完成后定格为 completedAt-startedAt。无 startedAt → null。 */
function useElapsed(startedAt?: number, completedAt?: number): string | null {
  const [now, setNow] = useState(() => Date.now())
  const running = startedAt != null && completedAt == null
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => setNow(Date.now()), 150)
    return () => clearInterval(t)
  }, [running])
  if (startedAt == null) return null
  const end = completedAt ?? now
  return fmtDuration(end - startedAt)
}

export function kindOf(name: string): OpKind {
  if (/^(Edit|Write|MultiEdit)$/.test(name)) return 'edit'
  if (name === 'Bash') return 'bash'
  if (name === 'TodoWrite') return 'todo'
  return 'read'
}

type ResultState = 'running' | 'ok' | 'err'

interface OpCardProps {
  name: string
  input: unknown
  result?: { ok: boolean; content: string } | null
  startedAt?: number
  completedAt?: number
  /** 当前项目根绝对路径（用于读取/编辑卡路径精简，Issue 9）。 */
  projectRoot?: string
  /** bash/read 卡点击：在右侧预览开命令 tab（含完整命令 + 输出）。 */
  onOpen?: () => void
  /** 编辑卡点击：在左侧会话浮层看完整 diff（Issue 21）。 */
  onOpenDiff?: (d: { filePath: string; oldStr: string; newStr: string }) => void
}

// 编辑卡折叠阈值：超过这些行只显示前 N 行 + 「点击看全」（Issue 21）。
const DIFF_COLLAPSE_ROWS = 10

/** 单行 diff 渲染：双列行号（旧/新）+ 槽标记（+/-/空）+ 文本（Issue 25 VS Code 风格）。 */
export function DiffLine({ row }: { row: DiffRow }) {
  const sign = row.type === 'add' ? '+' : row.type === 'del' ? '−' : ' '
  return (
    <span className={`dl ${row.type}`}>
      <span className="dl-no">{row.oldNo ?? ''}</span>
      <span className="dl-no">{row.newNo ?? ''}</span>
      <span className="dl-sign">{sign}</span>
      <span className="dl-text">{row.text === '' ? ' ' : row.text}</span>
    </span>
  )
}

function statusText(kind: OpKind, state: ResultState, input: Record<string, unknown>, result?: { ok: boolean; content: string } | null): string {
  if (state === 'running') return '进行中'
  if (state === 'err') return '失败'
  if (kind === 'bash') {
    return result?.ok ? '退出 0' : '退出 1'
  }
  return '成功'
}

export function OpCard({ name, input, result, startedAt, completedAt, projectRoot, onOpen, onOpenDiff }: OpCardProps) {
  const kind = kindOf(name)
  const inp = input as Record<string, unknown>
  const state: ResultState = result === undefined || result === null ? 'running' : result.ok ? 'ok' : 'err'
  const elapsed = useElapsed(startedAt, completedAt)

  if (kind === 'read') {
    const filePath = (inp.file_path ?? inp.path ?? '') as string
    return (
      <div className={`op-card${onOpen ? ' is-clickable' : ''}`} onClick={onOpen} title={onOpen ? '点击在右侧查看读取内容' : undefined}>
        <div className="op-head">
          <span className="op-icon read">R</span>
          <span className="op-title">读取</span>
          {filePath && <span className="op-path" title={filePath}>{displayPath(filePath, projectRoot)}</span>}
          {elapsed && <span className="op-timer">{elapsed}</span>}
          <span className={`op-status ${state}`}>{statusText(kind, state, inp, result)}</span>
        </div>
      </div>
    )
  }

  if (kind === 'bash') {
    const command = (inp.command ?? '') as string
    // 命令的人话描述（Bash 工具 input.description，已透传，VS Code 风格灰字副标题，Issue 24）
    const desc = typeof inp.description === 'string' ? inp.description.trim() : ''
    // VSCode 风格：IN（命令）/ OUT（输出）各最多 3 行、不换行（超出截断）；点击整卡 → 右侧开命令 tab 看全文
    return (
      <div className={`op-card op-bash${onOpen ? ' is-clickable' : ''}`} onClick={onOpen} title={onOpen ? '点击在右侧查看完整命令与输出' : undefined}>
        <div className="op-head">
          <span className="op-icon bash">$</span>
          <span className="op-title">运行命令</span>
          {desc && <span className="op-desc" title={desc}>{desc}</span>}
          {elapsed && <span className="op-timer">{elapsed}</span>}
          <span className={`op-status ${state}`}>{statusText(kind, state, inp, result)}</span>
        </div>
        {command && (
          <div className="op-io">
            <span className="op-io-tag in">IN</span>
            <pre className="op-io-body clamp3">{command}</pre>
          </div>
        )}
        {result && result.content && (
          <div className="op-io">
            <span className="op-io-tag out">OUT</span>
            <pre className="op-io-body clamp3">{result.content}</pre>
          </div>
        )}
      </div>
    )
  }

  if (kind === 'edit') {
    const filePath = (inp.file_path ?? inp.path ?? '') as string
    const oldStr = (inp.old_string ?? '') as string
    const newStr = (inp.new_string ?? '') as string
    const diff = buildDiff(oldStr, newStr)
    const diffLabel = state === 'ok' ? `+${diff.added} −${diff.removed}` : statusText(kind, state, inp, result)
    // 折叠：超过阈值只渲染前 N 行 + 「点击看全」，点击整卡在左侧会话浮层看完整 diff（Issue 21）
    const collapsed = diff.rows.length > DIFF_COLLAPSE_ROWS
    const shownRows = collapsed ? diff.rows.slice(0, DIFF_COLLAPSE_ROWS) : diff.rows
    const openFull = onOpenDiff ? () => onOpenDiff({ filePath, oldStr, newStr }) : undefined

    return (
      <div className={`op-card${openFull ? ' is-clickable' : ''}`} onClick={openFull} title={openFull ? '点击查看完整改动' : undefined}>
        <div className="op-head">
          <span className="op-icon edit">E</span>
          <span className="op-title">编辑</span>
          {filePath && <span className="op-path" title={filePath}>{displayPath(filePath, projectRoot)}</span>}
          {elapsed && <span className="op-timer">{elapsed}</span>}
          <span className={`op-status ${state}`}>{diffLabel}</span>
        </div>
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

  // fallback (should not reach for 'todo' since TodoCard handles it)
  return null
}
