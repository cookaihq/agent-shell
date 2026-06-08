/**
 * CtxFile.tsx — 当前打开文件上下文卡片（受控）
 *
 * 结构（对齐原型 workspace.html L69）：
 *   button.ctx-file[.is-off][hidden]
 *     > span.cf-sep + span.cf-tag（按类型字形，复用文件树 fileTag）
 *     + span.cf-name（.cf-name-head 可截 + .cf-name-tail 含后缀 → 中间省略）
 *
 * activeFile 来自文件区（FileWorkspace.onActiveFile，已联动）。
 * 排除态由 Composer 持有（受控）：excluded 决定是否「移出上下文」，点击回调 onToggleExclude。
 */
import { fileTag } from '../utils/fileTag'

interface CtxFileProps {
  /** 当前打开的文件名/路径；null 表示无文件或文件浏览器模式 → 隐藏 */
  activeFile: string | null
  /** 当前文件是否已被用户移出上下文（由 Composer 算好传入） */
  excluded: boolean
  /** 点击切换某路径的排除态 */
  onToggleExclude: (path: string) => void
}

// 文件名中间省略：保留开头 + 结尾（含扩展名），省略号落中间。
// 末尾保留段固定取最后 TAIL_KEEP 个字符（常见扩展名 2~5 位 → 后缀必在尾段内）；
// 名字不长于阈值则整名进头段、无需省略。CSS 让头段截断、尾段不收缩。
const TAIL_KEEP = 8
function splitName(name: string): { head: string; tail: string } {
  if (name.length <= TAIL_KEEP + 2) return { head: name, tail: '' }
  return { head: name.slice(0, -TAIL_KEEP), tail: name.slice(-TAIL_KEEP) }
}

export function CtxFile({ activeFile, excluded, onToggleExclude }: CtxFileProps) {
  // activeFile=null 时隐藏
  if (!activeFile) {
    return <button className="ctx-file" hidden type="button" />
  }

  const isOff = excluded
  // chip 只显示纯文件名（含后缀）；完整相对路径放进 title 首行，hover 仍可见
  const baseName = activeFile.split('/').pop() || activeFile
  const { head, tail } = splitName(baseName)
  // tooltip：第一行完整相对路径，第二行动作（精简措辞）
  const action = isOff ? '已移出 · 点击加回' : '在上下文中 · 点击移出'

  return (
    <button
      className={`ctx-file${isOff ? ' is-off' : ''}`}
      type="button"
      title={`${activeFile}\n${action}`}
      onClick={() => onToggleExclude(activeFile)}
    >
      <span className="cf-sep" />
      <span className="cf-tag">{fileTag(baseName)}</span>
      <span className="cf-name">
        <span className="cf-name-head">{head}</span>
        {tail && <span className="cf-name-tail">{tail}</span>}
      </span>
    </button>
  )
}
