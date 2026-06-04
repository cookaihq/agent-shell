const { contextBridge, ipcRenderer, webUtils } = require('electron')

import type { AgentShellBridge } from '@agent-shell/contracts'

// 通道名与 contracts 的 DESKTOP_IPC 重复声明（故意）：preload 保持 dependency-free，
// 不因引入 contracts 运行时值把 zod 等拖进沙箱 preload（贴 open-design preload 纪律）。
// 若改这些字面量，须同步 packages/contracts/src/desktop.ts 的 DESKTOP_IPC（有 contracts 测试钉值）。
const PICK_FOLDER = 'agent-shell:pick-folder'
const PICK_PATHS = 'agent-shell:pick-paths'
const AUTH_TOKEN = 'agent-shell:auth-token'
const TABS_GET = 'agent-shell:tabs-get'
const TABS_SET = 'agent-shell:tabs-set'
const OPEN_PATH = 'agent-shell:open-path'
const OPEN_EXTERNAL = 'agent-shell:open-external'

const bridge: AgentShellBridge = {
  // 同步取主进程持有的 per-process 会话密钥：preload 早于 renderer JS 执行，
  // renderer 首个 /api 请求前 window.agentShell.authToken 已就绪。
  authToken: ipcRenderer.sendSync(AUTH_TOKEN) as string,
  pickFolder: () => ipcRenderer.invoke(PICK_FOLDER) as Promise<string | null>,
  pickPaths: () => ipcRenderer.invoke(PICK_PATHS) as Promise<string[]>,
  // Electron 32+ 移除了 File.path；拖入文件的真实磁盘路径只能经 webUtils.getPathForFile 取得（同步，无需 IPC）。
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  // 顶部页签持久：主进程文件存储（与 daemon 随机端口/origin 无关，跨重启可恢复）。
  tabsGet: () => ipcRenderer.sendSync(TABS_GET) as string | null,
  tabsSet: (json: string) => ipcRenderer.send(TABS_SET, json),
  openPath: (absPath: string) =>
    ipcRenderer.invoke(OPEN_PATH, absPath) as Promise<{ ok: boolean; error?: string }>,
  openExternal: (url: string) =>
    ipcRenderer.invoke(OPEN_EXTERNAL, url) as Promise<{ ok: boolean; error?: string }>,
}

contextBridge.exposeInMainWorld('agentShell', bridge)
