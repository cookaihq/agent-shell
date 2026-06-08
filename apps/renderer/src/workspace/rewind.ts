/**
 * rewind.ts — rewind（文件检查点回退）相关的纯决策逻辑。
 *
 * 不依赖 React / DOM，可单独单测。
 *
 * 设计依据（2026-06-07 brainstorm）：
 *   - dryRun 先调 api.rewind(sid, undefined, true) 拿预览数据
 *   - 用 buildRewindConfirmText 把预览数据组成确认文案
 *   - 用户确认后实跑 api.rewind(sid, undefined, false)
 *   - canRewind:false 或 filesChanged 为空 → 文案提示无改动或不可回退
 */

/** api.rewind dryRun 返回的预览数据子集（仅决策逻辑关心的字段）。 */
export interface RewindPreview {
  canRewind: boolean
  error?: string
  filesChanged?: string[]
  insertions?: number
  deletions?: number
}

/**
 * 根据 dryRun 结果生成确认文案（纯函数，可单测）。
 *
 * 返回值：
 *   - `{ ok: true; text: string }` — 可弹确认框，text 是弹框正文
 *   - `{ ok: false; text: string }` — 不弹确认（直接提示 text，如「无检查点」「无改动」）
 */
export function buildRewindConfirmText(preview: RewindPreview): { ok: boolean; text: string } {
  if (!preview.canRewind) {
    return { ok: false, text: preview.error ?? '当前会话无可回退的检查点' }
  }
  const n = preview.filesChanged?.length ?? 0
  if (n === 0) {
    return { ok: false, text: '无文件改动，无需回退' }
  }
  const ins = preview.insertions ?? 0
  const del = preview.deletions ?? 0
  const diff = ins || del ? ` · +${ins} −${del} 行` : ''
  return { ok: true, text: `将回退 ${n} 个文件${diff}，确认回退？` }
}
