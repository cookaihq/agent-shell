import type { AgentShellBridge } from '@agent-shell/contracts'

declare global {
  interface Window {
    /** 仅桌面壳（Electron）内由 preload 注入；浏览器/dev 下为 undefined。 */
    agentShell?: AgentShellBridge
  }
}

export {}
