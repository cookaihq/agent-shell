import type { InstalledResp } from '@agent-shell/contracts'
import { CLI_TOOLS_CATALOG, EXTRA_WELL_KNOWN_BINS } from './catalog'

/**
 * 把本机已装的命令行工具拼成轻量系统提示块（注入 Claude 系统提示，让 agent 被动知道有啥可用）。
 * 仅含已装：catalog 命中(installed) + EXTRA 命中(installed) + custom（去重后的真自定义）。
 * catalog 工具描述取 catalog.summary；custom 取其 description（无则仅名字+版本）；EXTRA 仅名字+版本。
 * 无任何已装工具 → 返回 null（调用方据此不注入 append）。
 */
export function buildCliToolsContext(installedResp: InstalledResp): string | null {
  const seen = new Set<string>()
  const items: string[] = []
  // detected：catalog + EXTRA 的检测结果（detectAllCliTools 可能对同 id 出现多条——账本 custom 与 catalog 同 id，故按 id 去重）
  for (const d of installedResp.detected) {
    if (d.status !== 'installed' || seen.has(d.id)) continue
    const cat = CLI_TOOLS_CATALOG.find((c) => c.id === d.id)
    const extra = EXTRA_WELL_KNOWN_BINS.find((e) => e[0] === d.id)
    if (!cat && !extra) continue   // 既非目录也非 EXTRA 的 id（如 detected 含未知 bin）→ 跳过不进上下文
    seen.add(d.id)
    const name = cat?.name ?? extra?.[1] ?? d.id
    const desc = cat?.summary ?? ''   // EXTRA 无 summary
    const ver = d.version ? ` (v${d.version})` : ''
    items.push(desc ? `- ${name}${ver}: ${desc}` : `- ${name}${ver}`)
  }
  // 真自定义工具（installedResp.custom 已由 service 去重剔除账本）
  for (const c of installedResp.custom) {
    if (seen.has(c.id)) continue
    seen.add(c.id)
    const ver = c.version ? ` (v${c.version})` : ''
    items.push(c.description ? `- ${c.name}${ver}: ${c.description}` : `- ${c.name}${ver}`)
  }
  if (items.length === 0) return null
  return ['<available_cli_tools>', '以下命令行工具已安装、可直接调用：', ...items, '</available_cli_tools>'].join('\n')
}
