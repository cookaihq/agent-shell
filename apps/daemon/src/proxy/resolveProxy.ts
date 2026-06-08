import type { Engine } from '@agent-shell/contracts'
import type { AuthSourceStore } from '../auth/sourceStore'
import type { ProxyStore } from './store'
import { buildProxyUrl } from './proxyUrl'

/** 当前来源的代理意图（三态）：
 *  - { managed:false }            → cli-login：继承本机 ambient 代理，env 不增不删（spec §6.5 例外）。
 *  - { managed:true, url }        → 受管：有绑定代理，注入该 URL（先删继承再写）。
 *  - { managed:true, url:undef }  → 受管直连：无绑定（或绑定失效），删继承让「直连」真直连。 */
export interface ActiveProxy { managed: boolean; url?: string }

/** 解析当前来源的代理意图：cli-login → 继承本机环境(managed:false)；其余 → 受管(managed:true)，有绑定则 url，否则直连(删继承)。spec §6.5。 */
export function resolveActiveProxy(engine: Engine, sourceStore: AuthSourceStore, proxyStore: ProxyStore): ActiveProxy {
  const st = sourceStore.get(engine)
  if (st.activeSource === 'cli-login') return { managed: false }   // 继承 ambient，不增不删
  const proxyId = st.proxyBindings?.[st.activeSource]
  const p = proxyId ? proxyStore.get(proxyId) : undefined
  return { managed: true, url: p ? buildProxyUrl(p) : undefined }   // 绑定失效/无绑定 → url undefined = 直连(删继承)
}
