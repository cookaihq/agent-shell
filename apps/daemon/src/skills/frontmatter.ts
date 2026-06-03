/** 最小 SKILL.md frontmatter 解析：取 name + description（支持行内与 |/> 块标量）。不依赖 yaml 库。 */
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
      // 块标量：收集后续缩进行直到下一个顶层 key 或结束
      const block: string[] = []
      for (let j = i + 1; j < lines.length; j++) {
        if (/^[A-Za-z_][\w-]*:\s?/.test(lines[j])) break   // 下一个顶层 key
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
