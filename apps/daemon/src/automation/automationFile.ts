import { parse as yamlParse, stringify as yamlStringify } from 'yaml'
import { AutomationFrontmatter } from '@agent-shell/contracts'

const FM_RE = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/

/** 解析 AUTOMATION.md：分出 frontmatter（YAML，zod 校验）与正文 prompt。非法 → 抛 Error。 */
export function parseAutomationMd(md: string): { frontmatter: AutomationFrontmatter; prompt: string } {
  const m = md.match(FM_RE)
  if (!m) throw new Error('AUTOMATION.md 缺少 frontmatter（--- ... ---）')
  const raw = yamlParse(m[1]) as unknown
  const frontmatter = AutomationFrontmatter.parse(raw) // 非法字段 → ZodError
  return { frontmatter, prompt: m[2].trim() }
}

/** 序列化为 AUTOMATION.md 文本（frontmatter + 正文）。frontmatter 先经 zod 规范化。 */
export function serializeAutomationMd(fm: AutomationFrontmatter, prompt: string): string {
  const norm = AutomationFrontmatter.parse(fm)
  return `---\n${yamlStringify(norm).trimEnd()}\n---\n${prompt.trim()}\n`
}
