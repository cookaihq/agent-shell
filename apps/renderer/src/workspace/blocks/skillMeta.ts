/**
 * renderer 本地 SKILL.md frontmatter 解析（取 name + description）。
 * 逻辑复制自 daemon `apps/daemon/src/skills/frontmatter.ts`（canonical 来源）——
 * 跨包直接 import 不便，此处保留一份只读小副本；如需根治 DRY 可提到 @agent-shell/contracts 共享。
 */
export function parseSkillFrontmatter(md: string): { name?: string; description?: string } {
  const m = md.match(/^---\n([\s\S]*?)\n---/)
  if (!m) return {}
  const lines = m[1].split('\n')
  const out: { name?: string; description?: string } = {}
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    const kv = line.match(/^([A-Za-z_][\w-]*):\s?(.*)$/)
    if (!kv) continue
    const key = kv[1], val = kv[2]
    if (key !== 'name' && key !== 'description') continue
    if (val === '|' || val === '>' || val === '|-' || val === '>-') {
      const block: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        if (/^[A-Za-z_][\w-]*:\s?/.test(lines[j])) break
        block.push(lines[j].replace(/^\s{1,}/, ''))
        i = j
      }
      out[key as 'name' | 'description'] = block.join(' ').trim()
    } else {
      out[key as 'name' | 'description'] = val.trim()
    }
  }
  return out
}
