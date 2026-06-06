import type { DiffRow } from '../diff'

/** 单行 diff 渲染：双列行号（旧/新）+ 槽标记 + 文本（D3：保留现有双行号）。 */
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
