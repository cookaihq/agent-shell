import type { Engine } from '../api/types'

export interface ModelDisplay { name: string; id: string; showId: boolean }

/** 别名（自定义 providerLabel / 官方 modelAliases）→ 回落官方 label → value，作主行；
 *  value 作 ID 灰字副行（仅主≠value 才显，避免重复）。 */
export function resolveModelDisplay(
  engine: Engine, value: string,
  opts: { providerLabel?: string; officialLabel?: string; modelAliases?: Record<string, Record<string, string>> },
): ModelDisplay {
  const alias = opts.providerLabel || opts.modelAliases?.[engine]?.[value]
  const name = alias || opts.officialLabel || value
  return { name, id: value, showId: name !== value }
}
