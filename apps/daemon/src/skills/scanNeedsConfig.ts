import fs from 'node:fs'
import path from 'node:path'

// 凭证/配置特征（spec §5 静态扫描层）：环境变量读取、Bearer 鉴权、大写 KEY/TOKEN 名、外部凭证文件。
const PATTERNS: RegExp[] = [
  /Authorization:\s*Bearer/i,
  /process\.env\.\w+/,
  /process\.env\[/,
  /os\.environ|os\.getenv|getenv\s*\(/,
  /\b[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*_(?:API_KEY|APIKEY|KEY|TOKEN|SECRET)\b/,
  /\.aws\/credentials|\.netrc|\.config\/[^\s'"]*\/(?:credentials|token)|credentials\.json/,
]
// 只扫第一层这些扩展名的脚本 + SKILL.md（控成本，spec：便宜、无 LLM）。
const SCRIPT_EXT = new Set(['.py', '.sh', '.js', '.ts', '.mjs', '.cjs', '.rb', '.go', '.env', ''])
const MAX_BYTES = 64 * 1024

function readHead(file: string): string {
  try {
    const buf = fs.readFileSync(file)
    return buf.subarray(0, MAX_BYTES).toString('utf8')
  } catch { return '' }
}

/** 静态扫描某技能目录是否需要配置（快信号）。读 SKILL.md + 第一层脚本，命中任一凭证特征即 true。
 *  只扫第一层（不递归），SKILL.md 不存在或无任何特征 → false。 */
export function scanNeedsConfig(skillDir: string): boolean {
  const mdPath = path.join(skillDir, 'SKILL.md')
  if (!fs.existsSync(mdPath)) return false
  let text = readHead(mdPath)
  let ents: fs.Dirent[] = []
  try { ents = fs.readdirSync(skillDir, { withFileTypes: true }) } catch { /* */ }
  for (const e of ents) {
    if (!e.isFile()) continue
    if (e.name === 'SKILL.md') continue
    if (!SCRIPT_EXT.has(path.extname(e.name))) continue
    text += '\n' + readHead(path.join(skillDir, e.name))
  }
  return PATTERNS.some((re) => re.test(text))
}
