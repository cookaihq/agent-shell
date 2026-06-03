import { execFileSync } from 'node:child_process'
import type { Engine } from '@agent-shell/contracts'

const LABEL: Record<Engine, string> = { claude: 'Claude Code', codex: 'Codex CLI' }
export function engineLabel(name: Engine): string { return LABEL[name] }

type RunVersion = (bin: string) => string
// 3s 探测超时（对齐 open-design versionProbeTimeoutMs 默认）：`--version` 正常 <1s，
// 卡住的坏 shim 最多拖 3s 即被杀。配合 detection 按版本降序「第一个能跑的就用」，正常根本碰不到坏版本。
const realRun: RunVersion = (bin) => execFileSync(bin, ['--version'], { encoding: 'utf8', timeout: 3000 })

/** 跑 `<bin> --version` 解析版本号；首个形如 N.N(.N…) 的 token。失败返回 null。 */
export function detectEngineVersion(bin: string, run: RunVersion = realRun): string | null {
  try {
    const out = run(bin).trim()
    const m = out.match(/\d+\.\d+(?:\.\d+)?/)   // 2.1.156 / 0.132.0
    return m ? m[0] : null
  } catch { return null }
}
