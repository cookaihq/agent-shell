import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'
import type { Engine } from '@agent-shell/contracts'

const DIRS: Record<Engine, string> = { claude: '.claude/skills', codex: '.codex/skills' }

/** 检测技能名是否存在于全局引擎技能目录（个人级，会覆盖项目级注入）。home 可注入（测试用）。 */
export function detectGlobalEngines(name: string, home = os.homedir()): Engine[] {
  const out: Engine[] = []
  for (const e of ['claude', 'codex'] as Engine[]) {
    if (fs.existsSync(path.join(home, DIRS[e], name, 'SKILL.md'))) out.push(e)
  }
  return out
}
