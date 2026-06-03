import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { app, BrowserWindow, ipcMain, dialog, Menu, shell, type MenuItemConstructorOptions } from 'electron'
import { DESKTOP_IPC } from '@agent-shell/contracts'
import { discoverDaemonUrl } from '@agent-shell/sidecar'
import { startDaemonProcess, type DaemonHandle } from './daemonProcess'
import { initUpdater } from './updater'

// 说明：本文件经 esbuild 打成 CJS（dist/main.cjs），上面的具名导入会被转成
// `require('electron')`——这是 Electron 主进程注入内置 electron 模块的标准可靠路径
// （ESM 产物下 Electron 的内置模块注入不可靠，故主进程走 CJS）。CJS 产物用原生
// __dirname 定位路径（esbuild 不在 CJS 下 shim import.meta.url）。

// renderer 产物：build 把 renderer/web-dist 拷到 desktop dist/web；main.cjs 在 dist/ 下，故同级 ./web。
// 统一布局（M8d）——dev(electron dist/main.cjs) 与打包(Resources/app/dist/main.cjs) 解析一致，无需 app.isPackaged 分支。
const webDir = path.resolve(__dirname, 'web')

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
        { type: 'separator' },
        { role: 'resetZoom' }, { role: 'zoomIn' }, { role: 'zoomOut' },
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

const DAEMON_NAMESPACE = 'agent-shell'
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
  let currentUrl: string | null = null
  const probe = async (): Promise<string | null> => {
    try { return await discoverDaemonUrl({ namespace: DAEMON_NAMESPACE, timeoutMs: 200, intervalMs: 60 }) }
    catch { return null }
  }
  const tick = async (): Promise<void> => {
    if (win.isDestroyed()) return
    const url = await probe()
    if (url && url !== currentUrl && !win.isDestroyed()) {
      currentUrl = url
      try { await win.loadURL(url + '/') }
      catch (err) { console.error('[desktop] 加载 daemon URL 失败:', err) }
    }
    if (win.isDestroyed()) return
    setTimeout(() => { void tick() }, url ? RUNNING_POLL_MS : PENDING_POLL_MS)
  }
  void tick()
}

async function createWindow(): Promise<void> {
  // sendSync 取密钥：preload 同步拿，renderer 首请求前就绪
  ipcMain.on(DESKTOP_IPC.authToken, (e) => { e.returnValue = authSecret })
  // 原生文件夹选择器：返回所选绝对路径或 null（取消）
  ipcMain.handle(DESKTOP_IPC.pickFolder, async () => {
    const r = await dialog.showOpenDialog({ properties: ['openDirectory'] })
    return r.canceled || r.filePaths.length === 0 ? null : r.filePaths[0]
  })
  // 顶部页签持久：renderer 经 preload sendSync 读、send 写主进程文件
  ipcMain.on(DESKTOP_IPC.tabsGet, (e) => { e.returnValue = readTabsState() })
  ipcMain.on(DESKTOP_IPC.tabsSet, (_e, json: unknown) => { if (typeof json === 'string') writeTabsState(json) })

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
  installMacChromeCss(win)

  // 先上加载页，立刻有反馈；再 spawn daemon（不阻塞），由轮询在其就绪后切到真页面。
  await win.loadURL(pendingHtml())
  daemon = startDaemonProcess({ webDir, namespace: DAEMON_NAMESPACE, authSecret })
  startUrlDiscoveryLoop(win)
}

app.whenReady().then(async () => {
  installAppMenu()   // 系统菜单栏（替换 Electron 默认菜单）
  await createWindow()
  initUpdater()   // 仅打包态查更新（dev 内部直接 return）；全程 fail-soft
}).catch((err) => {
  console.error('[desktop] 启动失败:', err)
  app.quit()
})

// 窗口全关 → 关停 daemon → 退出（mac 习惯保留 dock，但 M8a 先简单全退）
app.on('window-all-closed', async () => {
  if (daemon) await daemon.stop()
  app.quit()
})

app.on('before-quit', async () => { if (daemon) await daemon.stop() })

// 兜底：主进程未捕获异常 / 正常 exit 时，同步强杀 daemon 子进程，避免孤儿进程累积。
// 注：主进程被 SIGKILL 时无法运行任何回调，该场景的孤儿需子进程侧自我守护（M8 后续硬化）。
process.on('uncaughtException', (err) => {
  console.error('[desktop] 未捕获异常:', err)
  daemon?.killSync()
  process.exit(1)
})
process.on('exit', () => { daemon?.killSync() })
