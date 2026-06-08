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
  /** ipcRenderer.invoke：把一组绝对路径移到系统废纸篓（shell.trashItem 逐个），返回 {ok, failed[]}。 */
  trashItem: 'agent-shell:trash-item',
  /** ipcRenderer.invoke：在系统文件管理器（Finder）中定位并选中某绝对路径（shell.showItemInFolder），返回 {ok,error}。 */
  showItemInFolder: 'agent-shell:show-item',
  /** ipcRenderer.sendSync：查主进程当前已检测到的可用更新（UpdateState）或 null（无新版）。 */
  updateState: 'agent-shell:update-state',
  /** 主→渲染 push（webContents.send）：检测到新版时推 UpdateState，驱动右上角常驻图标。 */
  updateAvailable: 'agent-shell:update-available',
  /** ipcRenderer.send：renderer 请求主进程弹系统通知（Electron Notification）。载荷：ReminderNotify。 */
  showReminder: 'agent-shell:show-reminder',
  /** 主→渲染 push（webContents.send）：用户点击通知后激活对应项目/会话。载荷：ReminderActivate。 */
  reminderActivate: 'agent-shell:reminder-activate',
  /** ipcRenderer.invoke：检测本机已安装哪些编辑器，返回归一化列表（按平台过滤+排序）。 */
  detectEditors: 'agent-shell:detect-editors',
  /** ipcRenderer.invoke：用指定编辑器打开某绝对路径（项目根目录），返回 {ok,error}。 */
  openInEditor: 'agent-shell:open-in-editor',
} as const

/** 可用更新信息：版本号 + 下载页地址（由主进程随检测结果下发，前端不另硬编码 URL）。 */
export interface UpdateState {
  version: string
  releasesUrl: string
}

/** 「在编辑器中打开」下拉的一个条目（主进程检测后下发，渲染层只渲染）。 */
export interface EditorEntry {
  id: string
  label: string
  installed: boolean
}

// ── 提醒（Reminders）IPC 载荷 ──────────────────────────────────────
/**
 * 渲染进程 → 主进程（ipcRenderer.send）：renderer 请求主进程弹 Electron 系统通知。
 * renderer 在 useAgentStream 回调中检测到 system 渠道后，经 preload 桥调用，主进程负责弹 Notification。
 */
export interface ReminderNotify {
  projectId: string
  sessionId: string
  event: 'attention' | 'complete' | 'failed'
  title: string
  body: string
}

/**
 * 用户点击通知 → 主进程 → 渲染进程：聚焦对应项目/会话。
 * 预留给 T5（main/preload 实现），本任务仅加类型契约。
 */
export interface ReminderActivate {
  projectId: string
  sessionId: string
}

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
  /** 把一组绝对路径移到系统废纸篓（可恢复）。逐个 try/catch，未删成功的进 failed[]。 */
  trashItem: (absPaths: string[]) => Promise<{ ok: boolean; failed: string[] }>
  /** 在系统文件管理器（Finder）中定位并选中某绝对路径。ok=false 时 error 为系统错误信息。 */
  showItemInFolder: (absPath: string) => Promise<{ ok: boolean; error?: string }>
  /** 同步查当前可用更新（无则 null）。挂载时主动拉一次，配合 onUpdateAvailable 防时序竞争。 */
  getUpdateState: () => UpdateState | null
  /** 订阅主进程「发现新版」推送，返回退订函数。 */
  onUpdateAvailable: (cb: (s: UpdateState) => void) => () => void
  /**
   * 渲染 → 主进程（fire-and-forget）：renderer 请求主进程弹 Electron 系统通知（T5 实现）。
   * preload 内调用 ipcRenderer.send(DESKTOP_IPC.showReminder, payload)。
   */
  showReminder: (payload: ReminderNotify) => void
  /**
   * 订阅主进程「通知被点击」推送（主 → 渲染 webContents.send）：返回退订函数（T5 实现）。
   * 收到后 renderer 聚焦对应项目/会话（T8 接）。
   */
  onReminderActivate: (cb: (p: ReminderActivate) => void) => () => void
  /** 检测本机已安装的编辑器（按当前平台过滤+排序）。无桌面壳则前端不会调用。 */
  detectEditors: () => Promise<EditorEntry[]>
  /** 用 id 对应编辑器打开绝对路径（项目根）。id 未命中/未安装 → ok=false。 */
  openInEditor: (id: string, absPath: string) => Promise<{ ok: boolean; error?: string }>
}
