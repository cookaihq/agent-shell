import { diffLines } from 'diff'

/** 一行 diff 的类型：上下文（未变）/ 新增 / 删除。 */
export type DiffRowType = 'ctx' | 'add' | 'del'

/** 一行 diff：带旧/新行号（仅相应侧有值）。 */
export interface DiffRow {
  type: DiffRowType
  text: string
  oldNo?: number
  newNo?: number
}

export interface DiffResult {
  rows: DiffRow[]
  /** 新增行数 / 删除行数（卡片标题 +N −M 用）。 */
  added: number
  removed: number
}

// diffLines 的每个 change.value 是若干行拼成的串，通常以 \n 结尾；拆成行并去掉结尾空串。
function splitLines(value: string): string[] {
  const lines = value.split('\n')
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop()
  return lines
}

/**
 * 真逐行 diff（Issue 25）：用成熟库 diff 的 diffLines 做 LCS，产出有序三态行 + 双列行号。
 * 替换旧的「旧串整段删 + 新串整段增」假 diff。
 */
export function buildDiff(oldStr: string, newStr: string): DiffResult {
  const changes = diffLines(oldStr ?? '', newStr ?? '')
  const rows: DiffRow[] = []
  let oldNo = 1
  let newNo = 1
  let added = 0
  let removed = 0
  for (const ch of changes) {
    const lines = splitLines(ch.value)
    if (ch.added) {
      for (const text of lines) { rows.push({ type: 'add', text, newNo: newNo++ }); added++ }
    } else if (ch.removed) {
      for (const text of lines) { rows.push({ type: 'del', text, oldNo: oldNo++ }); removed++ }
    } else {
      for (const text of lines) rows.push({ type: 'ctx', text, oldNo: oldNo++, newNo: newNo++ })
    }
  }
  return { rows, added, removed }
}
