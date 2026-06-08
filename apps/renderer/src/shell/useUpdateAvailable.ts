import { useEffect, useState } from 'react'
import type { AgentShellBridge, UpdateState } from '@agent-shell/contracts'

// 桌面壳桥（window.agentShell）；浏览器/dev 下 undefined。沿用项目既有访问先例（FileWorkspace.getBridge / workspaceTabs.bridge）。
function getBridge(): AgentShellBridge | undefined {
  return (globalThis as { agentShell?: AgentShellBridge }).agentShell
}

/**
 * 订阅"有可用更新"状态。**先订阅、后查询**（spec §3）：先 onUpdateAvailable 注册监听，再 getUpdateState 取初值，
 * 焊死"查询返 null 与监听注册之间检测落地"的理论缝隙。浏览器/dev 无 bridge → 恒 null。
 */
export function useUpdateAvailable(): UpdateState | null {
  const [state, setState] = useState<UpdateState | null>(null)
  useEffect(() => {
    const b = getBridge()
    if (!b) return
    const unsub = b.onUpdateAvailable((s) => setState(s))
    const initial = b.getUpdateState()
    if (initial) setState(initial)
    return unsub
  }, [])
  return state
}
