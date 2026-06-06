import { useElapsed } from './dumb/elapsed'
import { parseSkillFrontmatter } from './skillMeta'

interface SkillRowProps {
  /** Skill 工具 input（{skill, args}）。 */
  input: unknown
  /** Skill 工具 tool_result 内容（注入的 SKILL.md），用于解析 description。 */
  resultContent?: string
  startedAt?: number
  completedAt?: number
}

/** args（字符串或对象）→ 收起一行预览 + 展开完整文本；空则 null。 */
function formatArgs(args: unknown): { oneLine: string; full: string } | null {
  if (args == null || args === '') return null
  let full: string
  if (typeof args === 'string') full = args
  else {
    try { full = JSON.stringify(args, null, 2) } catch { full = String(args) }
  }
  const oneLine = full.replace(/\s+/g, ' ').trim()
  if (!oneLine) return null
  return { oneLine, full }
}

export function SkillRow({ input, resultContent, startedAt, completedAt }: SkillRowProps) {
  const inp = (input ?? {}) as { skill?: unknown; args?: unknown }
  const skill = typeof inp.skill === 'string' ? inp.skill : ''
  const elapsed = useElapsed(startedAt, completedAt)
  const desc = resultContent ? (parseSkillFrontmatter(resultContent).description ?? '') : ''
  const args = formatArgs(inp.args)

  return (
    <div className="sk-block">
      <div className="sk-line">
        <span className="sk-name">{skill || '技能'}</span>
        <span className="skill-tag">技能</span>
        {desc && <span className="sk-desc">{desc}</span>}
        {elapsed && <span className="sk-t">{elapsed}</span>}
      </div>
      {args && (
        <details className="sk-args">
          <summary>
            <span className="ska-prev">{args.oneLine}</span>
            <div className="ska-full">
              <div className="ska-txt">{args.full}</div>
              <span className="ska-less">收起</span>
            </div>
          </summary>
        </details>
      )}
    </div>
  )
}
