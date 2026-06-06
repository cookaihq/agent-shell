import fs from 'node:fs'; import path from 'node:path'
import type { CliToolDef } from '@agent-shell/contracts'
import { libraryManifestPath } from '../paths'

/** CLI 工具在技能库 manifest 里的合成源 id（非真实技能源，listLibrary 会以此名兜底显示）。 */
export const CLI_SOURCE_ID = 'cli-tools'
/** 库内目录名 / 注入名：cli-<id>，与普通技能命名空间隔开，避免撞名。 */
export const cliEffName = (id: string): string => `cli-${id}`

type ManifestEntry = { sourceId: string; name: string; relPath: string }
type Manifest = Record<string, ManifestEntry>
const readManifest = (file: string): Manifest => { try { return JSON.parse(fs.readFileSync(file, 'utf8')) as Manifest } catch { return {} } }
const writeManifest = (file: string, skillsDir: string, m: Manifest) => { fs.mkdirSync(skillsDir, { recursive: true }); fs.writeFileSync(file, JSON.stringify(m, null, 2)) }

/** 生成一个 CLI 工具的 SKILL.md 文本：frontmatter 让 Claude 知道何时/如何用这个命令。 */
export function cliToolSkillMd(def: CliToolDef): string {
  const description = (def.usage || def.desc || `使用 ${def.name} 命令行工具`).replace(/\n+/g, ' ').trim()
  const lines: string[] = []
  lines.push('---', `name: ${def.name}`, `description: ${description}`, '---', '')
  lines.push(`# ${def.name}`, '')
  if (def.desc) lines.push(def.desc, '')
  lines.push('## 安装', '', `本工具的可执行命令是 \`${def.cmd}\`。先确认本机已安装（\`which ${def.cmd}\`）；若未安装，可执行：`, '')
  lines.push('```bash', def.install || `# 请按官方文档安装 ${def.name}`, '```', '')
  lines.push('## 用法', '', def.usage || `调用 \`${def.cmd}\` 完成相关任务。`, '')
  if (def.home) lines.push(`> 官方文档：${def.home}`, '')
  lines.push('> 由 Agent Shell「命令行工具」集成自动生成。')
  return lines.join('\n')
}

/** 加入：写 skillsDir/cli-<id>/SKILL.md + 登记技能库 manifest（→ 可被注入选择器选中、软链进 .claude/skills）。 */
export function writeCliSkill(skillsDir: string, def: CliToolDef): string {
  const eff = cliEffName(def.id)
  const dir = path.join(skillsDir, eff)
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'SKILL.md'), cliToolSkillMd(def))
  const file = libraryManifestPath(skillsDir)
  const m = readManifest(file)
  m[eff] = { sourceId: CLI_SOURCE_ID, name: def.name, relPath: def.id }
  writeManifest(file, skillsDir, m)
  return eff
}

/** 移除：删 manifest 条目 + skillsDir/cli-<id> 目录。 */
export function removeCliSkill(skillsDir: string, id: string): void {
  const eff = cliEffName(id)
  const file = libraryManifestPath(skillsDir)
  const m = readManifest(file)
  if (m[eff]) { delete m[eff]; writeManifest(file, skillsDir, m) }
  try { fs.rmSync(path.join(skillsDir, eff), { recursive: true, force: true }) } catch { /* */ }
}
