import { buildDiff } from './diff'

export type OpKind = 'read' | 'bash' | 'edit' | 'todo'

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
}

function statusText(kind: OpKind, state: ResultState, input: Record<string, unknown>, result?: { ok: boolean; content: string } | null): string {
  if (state === 'running') return '进行中'
  if (state === 'err') return '失败'
  if (kind === 'bash') {
    return result?.ok ? '退出 0' : '退出 1'
  }
  return '成功'
}

export function OpCard({ name, input, result }: OpCardProps) {
  const kind = kindOf(name)
  const inp = input as Record<string, unknown>
  const state: ResultState = result === undefined || result === null ? 'running' : result.ok ? 'ok' : 'err'

  if (kind === 'read') {
    const filePath = (inp.file_path ?? inp.path ?? '') as string
    return (
      <div className="op-card">
        <div className="op-head">
          <span className="op-icon read">R</span>
          <span className="op-title">读取</span>
          {filePath && <span className="op-path">{filePath}</span>}
          <span className={`op-status ${state}`}>{statusText(kind, state, inp, result)}</span>
        </div>
      </div>
    )
  }

  if (kind === 'bash') {
    const command = (inp.command ?? '') as string
    return (
      <div className="op-card">
        <div className="op-head">
          <span className="op-icon bash">$</span>
          <span className="op-title">运行命令</span>
          <span className={`op-status ${state}`}>{statusText(kind, state, inp, result)}</span>
        </div>
        {command && <pre className="op-command">{command}</pre>}
        {result && result.content && <pre className="op-output">{result.content}</pre>}
      </div>
    )
  }

  if (kind === 'edit') {
    const filePath = (inp.file_path ?? inp.path ?? '') as string
    const oldStr = (inp.old_string ?? '') as string
    const newStr = (inp.new_string ?? '') as string
    const diff = buildDiff(oldStr, newStr)
    const addCount = diff.add.length
    const delCount = diff.del.length
    const diffLabel = state === 'ok' ? `+${addCount} −${delCount}` : statusText(kind, state, inp, result)

    return (
      <div className="op-card">
        <div className="op-head">
          <span className="op-icon edit">E</span>
          <span className="op-title">编辑</span>
          {filePath && <span className="op-path">{filePath}</span>}
          <span className={`op-status ${state}`}>{diffLabel}</span>
        </div>
        <pre className="op-diff">
          {diff.del.map((line, i) => (
            <span key={`del-${i}`} className="ln del">{`-  ${line}`}</span>
          ))}
          {diff.add.map((line, i) => (
            <span key={`add-${i}`} className="ln add">{`+  ${line}`}</span>
          ))}
        </pre>
      </div>
    )
  }

  // fallback (should not reach for 'todo' since TodoCard handles it)
  return null
}
