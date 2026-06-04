import type { Engine } from '@agent-shell/contracts'

// 引擎 → npm 包名（查最新版的来源）+ 官方 GitHub releases 页（点徽标的跳转目标）。
// 两者均已发布在 npm registry：claude 是 @anthropic-ai/claude-code，codex 是 @openai/codex。
// 选 npm registry 而非 GitHub API：前者无鉴权无限流，后者未鉴权 60 次/时易被限。
const NPM_PKG: Record<Engine, string> = {
  claude: '@anthropic-ai/claude-code',
  codex: '@openai/codex',
}
const GITHUB_RELEASES: Record<Engine, string> = {
  claude: 'https://github.com/anthropics/claude-code/releases',
  codex: 'https://github.com/openai/codex/releases',
}

type Cached = { version: string, at: number }
const cache = new Map<Engine, Cached>()
const TTL_MS = 60 * 60 * 1000   // 1h：避免每次开执行模式页都打 npm

/** 查 npm registry 拿某引擎 CLI 的最新发布版本。
 *  成功结果缓存 1h；失败（网络错/超时/非 2xx）返回 null 且不缓存，下次进页面重试。 */
async function fetchLatest(name: Engine): Promise<string | null> {
  const hit = cache.get(name)
  if (hit && Date.now() - hit.at < TTL_MS) return hit.version
  try {
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 4000)
    const res = await fetch(`https://registry.npmjs.org/${NPM_PKG[name]}/latest`, { signal: ctrl.signal })
    clearTimeout(timer)
    if (!res.ok) return null
    const j = await res.json() as { version?: unknown }
    if (typeof j.version !== 'string') return null
    cache.set(name, { version: j.version, at: Date.now() })   // 仅缓存成功值
    return j.version
  } catch {
    return null   // 静默降级：调用方据 null 不显示更新徽标
  }
}

/** 并发查 claude/codex 最新版，返回 {name, latestVersion, updateUrl}。永不抛（内部已吞错）。 */
export async function checkEngineUpdates(): Promise<{ name: Engine, latestVersion: string | null, updateUrl: string }[]> {
  const names: Engine[] = ['claude', 'codex']
  return Promise.all(names.map(async (name) => ({
    name,
    latestVersion: await fetchLatest(name),
    updateUrl: GITHUB_RELEASES[name],
  })))
}
