import type { Engine } from '@agent-shell/contracts'
import { claudeDef } from './defs/claude'
import { codexDef } from './defs/codex'
import type { RuntimeAgentDef } from './types'

const DEFS: Record<Engine, RuntimeAgentDef> = {
  claude: claudeDef,
  codex: codexDef,
}

/** 按引擎取声明式 def（加引擎 = 往 DEFS 加一项）。 */
export function getRuntimeDef(engine: Engine): RuntimeAgentDef {
  return DEFS[engine]
}
