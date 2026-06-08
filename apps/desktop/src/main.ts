import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { execFile } from 'node:child_process'
import { app, BrowserWindow, ipcMain, dialog, Menu, Tray, nativeImage, shell, Notification, type MenuItemConstructorOptions } from 'electron'
import { DESKTOP_IPC, type UpdateState, type ReminderNotify, type ReminderActivate, type EditorEntry } from '@agent-shell/contracts'
import { discoverDaemonUrl } from '@agent-shell/sidecar'
import { startDaemonProcess, type DaemonHandle } from './daemonProcess'
import { initUpdater } from './updater'
import { listEditors, detectInstalled, resolveOpen, resolveLabel, defaultDetectDeps, defaultOpenDeps } from './editors'
import { startAutomationNotifier, type AutomationNotifier } from './automationNotify'

// 说明：本文件经 esbuild 打成 CJS（dist/main.cjs），上面的具名导入会被转成
// `require('electron')`——这是 Electron 主进程注入内置 electron 模块的标准可靠路径
// （ESM 产物下 Electron 的内置模块注入不可靠，故主进程走 CJS）。CJS 产物用原生
// __dirname 定位路径（esbuild 不在 CJS 下 shim import.meta.url）。

// renderer 产物：build 把 renderer/web-dist 拷到 desktop dist/web；main.cjs 在 dist/ 下，故同级 ./web。
// 统一布局（M8d）——dev(electron dist/main.cjs) 与打包(Resources/app/dist/main.cjs) 解析一致，无需 app.isPackaged 分支。
const webDir = path.resolve(__dirname, 'web')
// §9 builtin 源：build 把 daemon/src/builtin-skills 拷到 desktop dist/builtin-skills；与 web 同级，路径一致。
const builtinSkillsDir = path.resolve(__dirname, 'builtin-skills')
// §16.3 builtin automation：build 把 daemon/src/builtin-automations 拷到 dist/builtin-automations；与 web 同级。
const builtinAutomationsDir = path.resolve(__dirname, 'builtin-automations')
// §10 create_automation（codex）：build 把 stdio MCP server 打成 dist/automation-mcp.bundle.mjs；与 main.cjs 同级。
const automationMcpEntry = path.resolve(__dirname, 'automation-mcp.bundle.mjs')

// per-process 会话密钥：传给 daemon（开 gate）+ 经 preload 注入 renderer（带 token）。生产环境每次启动新生成。
const authSecret = randomBytes(32).toString('base64url')

// 顶部页签持久化：存到 userData 下的文件。renderer 的 localStorage 按 origin 隔离，而 daemon 每次随机端口
// → origin 每次变 → localStorage 跨重启读不到；改由主进程文件存储（origin 无关），preload sendSync 同步读写。
const tabsFile = () => path.join(app.getPath('userData'), 'workspace-tabs.json')
function readTabsState(): string | null {
  try { return readFileSync(tabsFile(), 'utf8') } catch { return null }
}
function writeTabsState(json: string): void {
  try { writeFileSync(tabsFile(), json, 'utf8') } catch { /* best-effort，存储失败不影响功能 */ }
}

let daemon: DaemonHandle | null = null
// 托盘常驻：关窗不退、daemon 存活、调度器照跑（spec §2）。仅托盘「退出」/ Cmd+Q 置 isQuitting 才真退。
let tray: Tray | null = null
let mainWindow: BrowserWindow | null = null
// 主进程持有的"当前可用更新"：updater 检测到即写入；窗口重建后渲染进程经 getUpdateState 一查即得（与窗口生命周期解耦）。
let availableUpdate: UpdateState | null = null
let isQuitting = false
// 当前 daemon URL（URL 发现轮询写入）：托盘重开窗口 / 通知点击重建窗口时直接复用，无需重新等发现。
let currentDaemonUrl: string | null = null
let notifier: AutomationNotifier | null = null

// 自定义标题栏：仅 mac 隐藏原生标题栏、让自定义 chrome 栏上提为最顶行，
// 系统红黄绿按钮保留并手动定位（对齐参考实现 open-design runtime.ts MAC_WINDOW_CHROME）。
// 非 mac（Windows/Linux）为空对象——保持原生标题栏不变，仅靠 autoHideMenuBar 去掉菜单条。
const MAC_WINDOW_CHROME =
  process.platform === 'darwin'
    ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 12, y: 10 } }
    : {}

// mac 专属 CSS：chrome 栏整体可拖窗口 + 左侧给红黄绿留空位；可点子元素设 no-drag 以恢复点击。
// 注入而非写进 base.css —— 这套只在 mac 成立，非 mac 不注入即自动失效（开发态浏览器同理）。
// 注：padding-left 必须带 !important —— 注入是 user 来源普通声明，会被 base.css 的 author
// 声明（.chrome padding）压过；!important 让 user 声明胜出（对齐 open-design 的注入纪律）。
const MAC_CHROME_CSS = `
  .chrome { -webkit-app-region: drag; padding-left: 78px !important; }
  .chrome a,
  .chrome button,
  .chrome [role="button"],
  .chrome input,
  .chrome [contenteditable] { -webkit-app-region: no-drag; }
`

// 应用菜单：屏幕顶端系统菜单栏（mac 常驻；Windows/Linux 经 autoHideMenuBar 默认隐藏、Alt 唤出）。
// 裁剪自参考实现 open-design index.ts installDesktopMenu —— 去掉 agent-shell 没有的「导出诊断」，
// Help 指向公开仓（与 updater.ts RELEASES_PAGE 同源）。app 名走 app.name（打包态 = productName「Agent Shell」）。
const PROJECT_URL = 'https://github.com/cookaihq/agent-shell'

function installAppMenu(): void {
  const template: MenuItemConstructorOptions[] = [
    ...(process.platform === 'darwin'
      ? [{
          label: app.name,
          submenu: [
            { role: 'about' as const },
            { type: 'separator' as const },
            { role: 'services' as const },
            { type: 'separator' as const },
            { role: 'hide' as const },
            { role: 'hideOthers' as const },
            { role: 'unhide' as const },
            { type: 'separator' as const },
            { role: 'quit' as const },
          ],
        }]
      : [{ label: 'File', submenu: [{ role: 'quit' as const }] }]),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' }, { role: 'redo' }, { type: 'separator' },
        { role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' },
      ],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' }, { role: 'forceReload' }, { role: 'toggleDevTools' },
        // 不放 resetZoom/zoomIn/zoomOut —— 它们的快捷键会缩放整个渲染页面。
        // Cmd/Ctrl +/-/0 改由 renderer 捕获、只缩放预览区（见 Preview.tsx）。
        { type: 'separator' }, { role: 'togglefullscreen' },
      ],
    },
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' }, { role: 'zoom' },
        ...(process.platform === 'darwin'
          ? [{ type: 'separator' as const }, { role: 'front' as const }]
          : [{ role: 'close' as const }]),
      ],
    },
    {
      label: 'Help',
      submenu: [
        { label: 'Agent Shell 项目主页', click() { void shell.openExternal(PROJECT_URL) } },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function installMacChromeCss(win: BrowserWindow): void {
  if (process.platform !== 'darwin') return
  // did-finish-load 每次加载（含 dev 热重载）后重注入，避免刷新丢失
  win.webContents.on('did-finish-load', () => {
    if (win.isDestroyed()) return
    void win.webContents.insertCSS(MAC_CHROME_CSS, { cssOrigin: 'user' }).catch((err) => {
      console.error('[desktop] mac chrome CSS 注入失败:', err)
    })
  })
}

// 构建渠道：build 时由 esbuild define 内联（pack:mac:dev / build:dev 设 AGENT_SHELL_CHANNEL=dev）。
// 缺省 stable。渠道决定 namespace（IPC socket 隔离）+ dataDir（DB 隔离）+ projectsDir（项目文件隔离）+ 是否查更新。
const CHANNEL = process.env.AGENT_SHELL_CHANNEL || 'stable'
const IS_DEV_CHANNEL = CHANNEL === 'dev'
const DAEMON_NAMESPACE = IS_DEV_CHANNEL ? 'agent-shell-dev' : 'agent-shell'
const DATA_DIR = IS_DEV_CHANNEL ? '.agent-shell-dev' : '.agent-shell'
const PROJECTS_DIR = IS_DEV_CHANNEL ? 'AgentShell-dev' : 'AgentShell'
const PENDING_POLL_MS = 150    // daemon 未就绪时的轮询间隔（快，对齐 open-design 的 tick）
const RUNNING_POLL_MS = 2000   // 已加载后的低频轮询：daemon 重启换端口时自动重载窗口

// 启动加载页：窗口一开就显示它，避免 daemon 起来前的几秒空窗/黑屏（对齐 open-design createPendingHtml）。
// 用 data: URL 内联，零依赖；背景与 renderer 浅色底一致，切换真页面无闪白。
function pendingHtml(): string {
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>Agent Shell</title><style>
    html,body{height:100%;margin:0}
    body{display:flex;align-items:center;justify-content:center;background:#faf9f7;
      color:#74716b;font:13px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif}
    .box{display:flex;flex-direction:column;align-items:center;gap:14px}
    .spin{width:22px;height:22px;border:2px solid #e1e5eb;border-top-color:#c2410c;
      border-radius:50%;animation:r .7s linear infinite}
    @keyframes r{to{transform:rotate(360deg)}}
  </style></head><body><div class="box"><div class="spin"></div>
    <div>Agent Shell 正在启动…</div></div></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

// URL 发现轮询：先单次探测（短超时包住 discoverDaemonUrl 的轮询，取不到即 null），
// 取到且与当前不同 → loadURL 切到真页面；之后继续低频轮询，daemon 重启换端口也能自愈。
function startUrlDiscoveryLoop(win: BrowserWindow): void {
  let loadedUrl: string | null = null
  const probe = async (): Promise<string | null> => {
    try { return await discoverDaemonUrl({ namespace: DAEMON_NAMESPACE, timeoutMs: 200, intervalMs: 60 }) }
    catch { return null }
  }
  const tick = async (): Promise<void> => {
    if (win.isDestroyed()) return
    const url = await probe()
    if (url) {
      currentDaemonUrl = url                    // 记最新 URL（托盘重开 / 通知点击复用）
      if (url !== loadedUrl && !win.isDestroyed()) {
        loadedUrl = url
        try { await win.loadURL(url + '/') }
        catch (err) { console.error('[desktop] 加载 daemon URL 失败:', err) }
      }
      // 首次拿到 URL → 起自动化通知订阅（跨 daemon 重启自愈：URL 变了会重订阅）
      ensureNotifier(url)
    }
    if (win.isDestroyed()) return
    setTimeout(() => { void tick() }, url ? RUNNING_POLL_MS : PENDING_POLL_MS)
  }
  void tick()
}

/** 起 / 重指向自动化通知订阅（daemon SSE → 系统通知）。URL 变更（daemon 重启换端口）时重订阅。 */
function ensureNotifier(url: string): void {
  if (notifier && notifier.url === url) return
  notifier?.stop()
  notifier = startAutomationNotifier({ url, authSecret, onActivate: () => showMainWindow() })
}

// 用 execFile 跑打开命令（数组传参防注入）。win 下 launcher 常是 .cmd，需 shell 解析。
function execOpen(file: string, args: string[]): Promise<{ ok: boolean; error?: string }> {
  return new Promise(resolve => {
    execFile(file, args, { shell: process.platform === 'win32' }, (err) => {
      resolve(err ? { ok: false, error: err.message } : { ok: true })
    })
  })
}

// IPC 句柄一次性注册（whenReady 调一次）：ipcMain.handle 重复注册会抛错，故不能放进可被托盘多次调用的 createWindow。
function registerIpcHandlers(): void {
  // sendSync 取密钥：preload 同步拿，renderer 首请求前就绪
  ipcMain.on(DESKTOP_IPC.authToken, (e) => { e.returnValue = authSecret })
  // 原生文件夹选择器：返回所选绝对路径或 null（取消）
  ipcMain.handle(DESKTOP_IPC.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  // 原生文件/文件夹选择器（可多选）：返回所选绝对路径数组（取消为空数组）。消息附件用。
  ipcMain.handle(DESKTOP_IPC.pickPaths, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'openDirectory', 'multiSelections'] })
    return r.canceled ? [] : r.filePaths
  })
  // 顶部页签持久：renderer 经 preload sendSync 读、send 写主进程文件
  ipcMain.on(DESKTOP_IPC.tabsGet, (e) => { e.returnValue = readTabsState() })
  ipcMain.on(DESKTOP_IPC.tabsSet, (_e, json: unknown) => { if (typeof json === 'string') writeTabsState(json) })
  // 用系统默认程序打开本地文件（预览工具栏「在编辑器中打开」）。路径由 daemon 侧越界校验后给出。
  ipcMain.handle(DESKTOP_IPC.openPath, async (_e, absPath: unknown) => {
    if (typeof absPath !== 'string' || !absPath) return { ok: false, error: 'invalid path' }
    const error = await shell.openPath(absPath)   // 成功返回 ''，失败返回系统错误信息
    return { ok: !error, error: error || undefined }
  })
  // 在系统默认浏览器打开外部链接（CLI 更新 → 官方 GitHub 页）。仅放行 https，挡掉 file:// 等本地协议。
  ipcMain.handle(DESKTOP_IPC.openExternal, async (_e, url: unknown) => {
    if (typeof url !== 'string' || !/^https:\/\//i.test(url)) return { ok: false, error: 'invalid url' }
    try { await shell.openExternal(url); return { ok: true } }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'open failed' } }
  })
  // 把一组绝对路径移到系统废纸篓（可恢复删除）。逐个 shell.trashItem，失败项收进 failed[] 回报前端提示。
  // 路径由 daemon abs-path（带越界校验）解析得到，renderer 不自拼路径，与现有 openPath 一致。
  ipcMain.handle(DESKTOP_IPC.trashItem, async (_e, absPaths: unknown) => {
    if (!Array.isArray(absPaths)) return { ok: false, failed: [] as string[] }
    const failed: string[] = []
    for (const p of absPaths) {
      if (typeof p !== 'string' || !p) continue
      try { await shell.trashItem(p) } catch { failed.push(p) }   // trashItem 出错会 reject
    }
    return { ok: failed.length === 0, failed }
  })
  // 在系统文件管理器（Finder）中定位并选中某绝对路径（shell.showItemInFolder 同步无返回）。
  ipcMain.handle(DESKTOP_IPC.showItemInFolder, async (_e, absPath: unknown) => {
    if (typeof absPath !== 'string' || !absPath) return { ok: false, error: 'invalid path' }
    try { shell.showItemInFolder(absPath); return { ok: true } }
    catch (e) { return { ok: false, error: e instanceof Error ? e.message : 'show failed' } }
  })
  // 检测本机已安装的编辑器（按平台过滤+排序）。逐条 try/catch，单条失败按未安装计、不崩整列表。
  ipcMain.handle(DESKTOP_IPC.detectEditors, async (): Promise<EditorEntry[]> => {
    const plat = process.platform
    return listEditors(plat).map(def => {
      let installed = false
      try { installed = detectInstalled(def, plat, defaultDetectDeps) } catch { installed = false }
      return { id: def.id, label: resolveLabel(def, plat), installed }
    })
  })
  // 用指定编辑器打开项目根绝对路径。id 必须命中当前平台 catalog 白名单；launcher 优先、open -a/shell 兜底。
  ipcMain.handle(DESKTOP_IPC.openInEditor, async (_e, id: unknown, absPath: unknown) => {
    if (typeof id !== 'string' || typeof absPath !== 'string' || !absPath) return { ok: false, error: 'invalid args' }
    const def = listEditors(process.platform).find(d => d.id === id)
    if (!def) return { ok: false, error: 'unknown editor' }
    const action = resolveOpen(def, process.platform, absPath, defaultOpenDeps)
    if (action.type === 'shellOpenPath') {
      const error = await shell.openPath(absPath)
      return { ok: !error, error: error || undefined }
    }
    return execOpen(action.file, action.args)
  })
  ipcMain.on(DESKTOP_IPC.updateState, (e) => { e.returnValue = availableUpdate })
  // renderer 请求弹系统通知（T5）：主进程负责 Notification，点击后聚焦窗口并推 reminderActivate 给 renderer
  ipcMain.on(DESKTOP_IPC.showReminder, (_e, payload: ReminderNotify) => {
    if (!Notification.isSupported()) return
    const n = new Notification({ title: payload.title, body: payload.body })
    n.on('click', () => {
      showMainWindow()
      // 窗口重建是异步的（createWindow），但 mainWindow 赋值在 createWindow 入口同步发生；
      // 若窗口刚重建，稍微延迟一帧让 webContents ready 后再 send（照 automationNotify 点击 → showMainWindow 模式）。
      const sendActivate = (): void => {
        if (mainWindow && !mainWindow.isDestroyed()) {
          const activate: ReminderActivate = { projectId: payload.projectId, sessionId: payload.sessionId }
          mainWindow.webContents.send(DESKTOP_IPC.reminderActivate, activate)
        }
      }
      // 若是重建窗口（mainWindow 刚被置 null，createWindow 异步中），等一个宏任务
      if (mainWindow && !mainWindow.isDestroyed()) {
        sendActivate()
      } else {
        setTimeout(sendActivate, 300)
      }
    })
    n.show()
  })
}

async function createWindow(): Promise<void> {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    autoHideMenuBar: true,   // 去掉 Electron 菜单条（Windows/Linux 可见的那条 File/Edit）
    backgroundColor: '#faf9f7',   // 与加载页同底，建窗到首帧无白闪
    ...MAC_WINDOW_CHROME,
    webPreferences: {
      contextIsolation: true,
      preload: path.resolve(__dirname, 'preload.cjs'),
    },
  })
  mainWindow = win
  win.on('closed', () => { if (mainWindow === win) mainWindow = null })
  installMacChromeCss(win)

  // 右键菜单（Issue 18）：选中文字 → 复制；输入框 → 剪切/复制/粘贴/全选（editFlags 驱动）。
  // 一处统一覆盖整窗口；role 由 Electron 原生执行（作用于聚焦的 webContents），自带本地化文案。
  win.webContents.on('context-menu', (_e, params) => {
    const ef = params.editFlags
    const template: MenuItemConstructorOptions[] = []
    if (params.isEditable) {
      template.push(
        { role: 'cut', enabled: ef.canCut },
        { role: 'copy', enabled: ef.canCopy },
        { role: 'paste', enabled: ef.canPaste },
        { type: 'separator' },
        { role: 'selectAll' },
      )
    } else if (params.selectionText && params.selectionText.trim()) {
      template.push({ role: 'copy' })
    }
    if (template.length === 0) return
    Menu.buildFromTemplate(template).popup({ window: win })
  })

  // 重开窗口（托盘/通知点击）时 daemon 已在跑、URL 已知 → 直接加载真页面，免再过加载页。
  // 首次启动 daemon 未起 → 先上加载页，spawn daemon，轮询就绪后切真页。
  if (currentDaemonUrl) {
    try { await win.loadURL(currentDaemonUrl + '/') }
    catch { await win.loadURL(pendingHtml()) }
  } else {
    await win.loadURL(pendingHtml())
  }
  if (!daemon) daemon = startDaemonProcess({ webDir, namespace: DAEMON_NAMESPACE, authSecret, dataDir: DATA_DIR, projectsDir: PROJECTS_DIR, builtinSkillsDir, builtinAutomationsDir, automationMcpEntry })
  startUrlDiscoveryLoop(win)
}

/** 托盘「打开」/ 通知点击：有窗口 → 还原+聚焦；无窗口 → 重建（daemon 仍在跑）。 */
function showMainWindow(): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.show()
    mainWindow.focus()
    return
  }
  void createWindow()
}

// 托盘图标（18×18 单色圆点模板 PNG，内联 base64）：自包含、保证有效，mac 模板图自动适配深浅色。
// 不依赖 .icns（nativeImage.createFromPath 对 icns 支持不可靠），打包/ dev 一致。
const TRAY_ICON_PNG = 'iVBORw0KGgoAAAANSUhEUgAAABIAAAASCAYAAABWzo5XAAAAPklEQVR42mNgGEpgAQ5MliH/0TBJhmEzAJuBFBtC0LAFZBi0gFLX4HXVMDeIKoFNteinaoKkahahaqYdOAAALXaLEZmo0u0AAAAASUVORK5CYII='

/** 菜单栏托盘（spec §2）：常驻入口，关窗后仍可重开 / 真退。 */
function createTray(): void {
  if (tray) return
  const image = nativeImage.createFromDataURL(`data:image/png;base64,${TRAY_ICON_PNG}`)
  if (process.platform === 'darwin') image.setTemplateImage(true)
  tray = new Tray(image)
  tray.setToolTip('Agent Shell')
  const menu = Menu.buildFromTemplate([
    { label: '打开 Agent Shell', click: () => showMainWindow() },
    { type: 'separator' },
    { label: '退出', click: () => { isQuitting = true; app.quit() } },
  ])
  tray.setContextMenu(menu)
  // 单击托盘图标也重开窗口（Windows/Linux 习惯；mac 双击）
  tray.on('click', () => showMainWindow())
}

app.whenReady().then(async () => {
  installAppMenu()        // 系统菜单栏（替换 Electron 默认菜单）
  registerIpcHandlers()   // IPC 句柄一次性注册（createWindow 可被托盘多次调用，不能在那注册）
  createTray()            // 菜单栏托盘常驻入口
  await createWindow()
  // dev 渠道不查更新（不引导去下正式版）；正式版照旧仅打包态查。
  // 检测到新版：存一份 + 推给当前窗口（前端已开着即时点亮图标；窗口未就绪则靠 getUpdateState 兜底）。
  if (!IS_DEV_CHANNEL) initUpdater({
    onAvailable: (s) => {
      availableUpdate = s
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(DESKTOP_IPC.updateAvailable, s)
    },
  })
}).catch((err) => {
  console.error('[desktop] 启动失败:', err)
  app.quit()
})

// 窗口全关 → 缩托盘常驻（spec §2）：销毁窗口释放渲染进程内存，主进程 + daemon 继续活、调度器照跑。
// 仅 isQuitting（托盘「退出」/ Cmd+Q）时才真退。mac 本就不在关窗时退；这里统一让所有平台关窗都留托盘。
app.on('window-all-closed', () => {
  if (isQuitting) app.quit()
  // 否则什么都不做：留在托盘后台守时
})

// 点 Dock 图标（mac）/ 重新激活 app：有窗口聚焦、无窗口重建（daemon 仍在跑），与托盘「打开」同语义。
// 缺了它 → 关窗后 app 进程仍在（window-all-closed 不退），但点 Dock 图标无人接 activate → 看似「点了没反应」。
app.on('activate', () => showMainWindow())

// Cmd+Q / 系统退出 / 托盘退出都经此：置 isQuitting（让 window-all-closed 走真退），停通知订阅 + daemon。
app.on('before-quit', async () => {
  isQuitting = true
  notifier?.stop()
  if (daemon) await daemon.stop()
})

// 兜底：主进程未捕获异常 / 正常 exit 时，同步强杀 daemon 子进程，避免孤儿进程累积。
// 注：主进程被 SIGKILL 时无法运行任何回调，该场景的孤儿需子进程侧自我守护（M8 后续硬化）。
process.on('uncaughtException', (err) => {
  console.error('[desktop] 未捕获异常:', err)
  daemon?.killSync()
  process.exit(1)
})
process.on('exit', () => { daemon?.killSync() })
