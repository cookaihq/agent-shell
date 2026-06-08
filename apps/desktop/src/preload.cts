const { contextBridge, ipcRenderer, webUtils } = require('electron')

import type { AgentShellBridge, UpdateState } from '@agent-shell/contracts'

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
const TRASH_ITEM = 'agent-shell:trash-item'
const SHOW_ITEM = 'agent-shell:show-item'
const UPDATE_STATE = 'agent-shell:update-state'
const UPDATE_AVAILABLE = 'agent-shell:update-available'
// 提醒 IPC 通道（T5 实现 daemon→main 触发，此处仅 preload 订阅转发到 renderer）
const SHOW_REMINDER = 'agent-shell:show-reminder'
const REMINDER_ACTIVATE = 'agent-shell:reminder-activate'
const DETECT_EDITORS = 'agent-shell:detect-editors'
const OPEN_IN_EDITOR = 'agent-shell:open-in-editor'

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
  trashItem: (absPaths: string[]) =>
    ipcRenderer.invoke(TRASH_ITEM, absPaths) as Promise<{ ok: boolean; failed: string[] }>,
  showItemInFolder: (absPath: string) =>
    ipcRenderer.invoke(SHOW_ITEM, absPath) as Promise<{ ok: boolean; error?: string }>,
  getUpdateState: () => ipcRenderer.sendSync(UPDATE_STATE) as UpdateState | null,
  onUpdateAvailable: (cb: (s: UpdateState) => void) => {
    const handler = (_e: unknown, s: UpdateState) => cb(s)
    ipcRenderer.on(UPDATE_AVAILABLE, handler)
    return () => { ipcRenderer.off(UPDATE_AVAILABLE, handler) }
  },
  // T5 实现：renderer → main 请求弹系统通知（fire-and-forget send）
  showReminder: (payload: import('@agent-shell/contracts').ReminderNotify) => {
    ipcRenderer.send(SHOW_REMINDER, payload)
  },
  // T5 实现：main → renderer 通知点击激活（订阅，主进程 webContents.send 推）
  onReminderActivate: (cb) => {
    const handler = (_e: unknown, p: import('@agent-shell/contracts').ReminderActivate) => cb(p)
    ipcRenderer.on(REMINDER_ACTIVATE, handler)
    return () => { ipcRenderer.off(REMINDER_ACTIVATE, handler) }
  },
  detectEditors: () =>
    ipcRenderer.invoke(DETECT_EDITORS) as Promise<import('@agent-shell/contracts').EditorEntry[]>,
  openInEditor: (id: string, absPath: string) =>
    ipcRenderer.invoke(OPEN_IN_EDITOR, id, absPath) as Promise<{ ok: boolean; error?: string }>,
}

contextBridge.exposeInMainWorld('agentShell', bridge)
