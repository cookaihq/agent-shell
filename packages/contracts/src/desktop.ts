// 桌面壳（Electron）↔ renderer 的共享契约。daemon / renderer / desktop-main 全 import 此处；
// 唯 preload 因要保持 dependency-free 而重复声明通道字面量（见 apps/desktop/src/preload.cts 注释）。

/** preload 暴露的原生能力 IPC 通道名。 */
export const DESKTOP_IPC = {
  /** ipcRenderer.invoke：弹原生文件夹选择器，返回所选绝对路径或 null（取消）。 */
  pickFolder: 'agent-shell:pick-folder',
  /** ipcRenderer.invoke：弹原生文件/文件夹选择器（可多选），返回所选绝对路径数组（取消为空数组）。消息附件用。 */
  pickPaths: 'agent-shell:pick-paths',
  /** ipcRenderer.sendSync：取主进程持有的 per-process 会话密钥。 */
  authToken: 'agent-shell:auth-token',
  /** ipcRenderer.sendSync：读主进程持久的顶部页签状态 JSON（无则 null）。与 origin 无关，可跨重启。 */
  tabsGet: 'agent-shell:tabs-get',
  /** ipcRenderer.send：写顶部页签状态 JSON 到主进程文件（fire-and-forget）。 */
  tabsSet: 'agent-shell:tabs-set',
  /** ipcRenderer.invoke：用系统默认程序打开本地绝对路径（shell.openPath），返回 {ok,error}。 */
  openPath: 'agent-shell:open-path',
  /** ipcRenderer.invoke：在系统默认浏览器打开外部 https URL（shell.openExternal），返回 {ok,error}。主进程限定仅放行 https。 */
  openExternal: 'agent-shell:open-external',
} as const

/** 宽门会话 token 的请求头名（小写，便于 Express req.header 大小写无关读取）。 */
export const AUTH_HEADER = 'x-agent-shell-token'

/** daemon 未通过 token 校验时返回的错误码（HTTP 503）。 */
export const AUTH_PENDING_CODE = 'DESKTOP_AUTH_PENDING'

/** renderer 侧 window.agentShell 的类型（仅桌面壳内注入；浏览器/dev 下为 undefined）。 */
export interface AgentShellBridge {
  authToken: string
  pickFolder: () => Promise<string | null>
  /** 弹原生文件/文件夹选择器（可多选），返回所选绝对路径数组（取消为空数组）。消息附件用。 */
  pickPaths: () => Promise<string[]>
  /** 取拖入文件的磁盘绝对路径。Electron 32+ 已移除 File.path，统一走 webUtils.getPathForFile（仅 preload 可调）。 */
  getPathForFile: (file: File) => string
  /** 同步读主进程持久的顶部页签状态 JSON（无则 null）；与 daemon 端口/origin 无关，跨重启可用。 */
  tabsGet: () => string | null
  /** 写顶部页签状态 JSON 到主进程文件（fire-and-forget）。 */
  tabsSet: (json: string) => void
  /** 用系统默认程序打开本地绝对路径（HTML→浏览器、代码→默认编辑器）。ok=false 时 error 为系统错误信息。 */
  openPath: (absPath: string) => Promise<{ ok: boolean; error?: string }>
  /** 在系统默认浏览器打开外部 https URL（CLI 更新 → 官方 GitHub 页）。主进程仅放行 https，否则 ok=false。 */
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>
}
