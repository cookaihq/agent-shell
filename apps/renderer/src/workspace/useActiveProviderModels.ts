import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Engine, ProvidersResp } from '../api/types'
import type { UIModelOption } from './agents/types'

/** 从 providers 响应取某引擎 active provider 的 models（default → 空，让前端回落引擎官方）。 */
export function pickActiveProviderModels(resp: ProvidersResp, engine: Engine): UIModelOption[] {
  const eng = resp.engines[engine]
  if (!eng || eng.active === 'default') return []
  const p = eng.providers.find((x) => x.id === eng.active)
  return (p?.models ?? []).map((m) => ({ value: m.value, label: m.label }))
}

/** 每引擎 active provider 的 defaultModel（default Provider → 不含该键，由 seedModel 回落）。 */
export function activeProviderDefaults(resp: ProvidersResp): Record<string, string> {
  const out: Record<string, string> = {}
  for (const engine of ['claude', 'codex'] as const) {
    const eng = resp.engines[engine]
    if (!eng || eng.active === 'default') continue
    const p = eng.providers.find((x) => x.id === eng.active)
    if (p?.defaultModel) out[engine] = p.defaultModel
  }
  return out
}

/** 拉一次 active provider 的 models（自定义 Provider 用；default 返回空）。enabled 为 false 时不拉。 */
export function useActiveProviderModels(engine: Engine, enabled: boolean): UIModelOption[] {
  const [models, setModels] = useState<UIModelOption[]>([])
  useEffect(() => {
    if (!enabled) return
    let off = false
    api.listProviders().then((r) => { if (!off) setModels(pickActiveProviderModels(r, engine)) }).catch(() => {})
    return () => { off = true }
  }, [engine, enabled])
  return models
}
