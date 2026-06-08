// 编辑器目录表（catalog）+ 跨平台「检测装没装 / 解析打开动作」的纯函数。
// 刻意 Electron-free（只用 node:fs/os/path）：便于单测；shell.openPath / execFile 这层执行在 main.ts。
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, delimiter } from 'node:path'

export type Platform = NodeJS.Platform | string

/** 一个编辑器在 catalog 中的定义。kind 决定打开方式族；mac/win 给各平台的检测与启动信息。 */
export interface EditorDef {
  id: string
  label: string
  /** editor=第三方应用(launcher 或 open -a)；fileManager=Finder/Explorer(shell 打开)；terminal=系统终端 */
  kind: 'editor' | 'fileManager' | 'terminal'
  mac?: { appName: string; launcher?: string }
  win?: { launcher?: string; label?: string }
}

/** 打开动作描述：editors.ts 只产出描述，main.ts 据此执行 shell.openPath 或 execFile。 */
export type OpenAction =
  | { type: 'shellOpenPath' }
  | { type: 'exec'; file: string; args: string[] }

/** 注入式依赖（便于测试，默认走真实实现）。 */
export interface DetectDeps { existsSync: (full: string) => boolean; home: string; which: (cmd: string) => string | null }
export interface OpenDeps { which: (cmd: string) => string | null }

// 顺序对照参考图：Cursor, VS Code, Antigravity, Xcode, Finder, Warp, Windsurf, Zed, Qoder, WebStorm, IntelliJ, Terminal
// launcher 名是 best-effort（well-known CLI）；不在 PATH 时 mac 退回 open -a、win 计为未安装——错/缺无副作用。
export const EDITOR_CATALOG: EditorDef[] = [
  { id: 'cursor',      label: 'Cursor',        kind: 'editor',      mac: { appName: 'Cursor', launcher: 'cursor' },               win: { launcher: 'cursor' } },
  { id: 'vscode',      label: 'VS Code',       kind: 'editor',      mac: { appName: 'Visual Studio Code', launcher: 'code' },      win: { launcher: 'code' } },
  { id: 'antigravity', label: 'Antigravity',   kind: 'editor',      mac: { appName: 'Antigravity', launcher: 'antigravity' },     win: { launcher: 'antigravity' } },
  { id: 'xcode',       label: 'Xcode',         kind: 'editor',      mac: { appName: 'Xcode' } },
  { id: 'finder',      label: 'Finder',        kind: 'fileManager', mac: { appName: 'Finder' },                                   win: { label: '文件资源管理器' } },
  { id: 'warp',        label: 'Warp',          kind: 'editor',      mac: { appName: 'Warp' } },
  { id: 'windsurf',    label: 'Windsurf',      kind: 'editor',      mac: { appName: 'Windsurf', launcher: 'windsurf' },           win: { launcher: 'windsurf' } },
  { id: 'zed',         label: 'Zed',           kind: 'editor',      mac: { appName: 'Zed', launcher: 'zed' },                     win: { launcher: 'zed' } },
  { id: 'qoder',       label: 'Qoder',         kind: 'editor',      mac: { appName: 'Qoder', launcher: 'qoder' },                 win: { launcher: 'qoder' } },
  { id: 'webstorm',    label: 'WebStorm',      kind: 'editor',      mac: { appName: 'WebStorm', launcher: 'webstorm' },           win: { launcher: 'webstorm' } },
  { id: 'intellij',    label: 'IntelliJ IDEA', kind: 'editor',      mac: { appName: 'IntelliJ IDEA', launcher: 'idea' },          win: { launcher: 'idea' } },
  { id: 'terminal',    label: 'Terminal',      kind: 'terminal',    mac: { appName: 'Terminal' },                                 win: { label: '终端' } },
]

/** 当前平台适用的编辑器（mac=有 mac 字段；win=有 win 字段；其他=空）。保持 catalog 顺序。 */
export function listEditors(platform: Platform): EditorDef[] {
  if (platform === 'darwin') return EDITOR_CATALOG.filter(d => d.mac)
  if (platform === 'win32') return EDITOR_CATALOG.filter(d => d.win)
  return []
}

/** 平台显示名：Finder/Terminal 在 win 用本地化名（文件资源管理器/终端），其余用 def.label。 */
export function resolveLabel(def: EditorDef, platform: Platform): string {
  if (platform === 'win32' && def.win?.label) return def.win.label
  return def.label
}

/** 扫 PATH 找可执行启动器（win 带 PATHEXT）；找不到返回 null。 */
export function whichOnPath(cmd: string, env: NodeJS.ProcessEnv = process.env, platform: Platform = process.platform): string | null {
  const PATH = env.PATH || ''
  const exts = platform === 'win32' ? (env.PATHEXT || '.EXE;.CMD;.BAT').split(';') : ['']
  for (const dir of PATH.split(delimiter)) {
    if (!dir) continue
    for (const ext of exts) {
      const full = join(dir, cmd + ext)
      if (existsSync(full)) return full
    }
  }
  return null
}

/** 这个编辑器装没装。Finder/Terminal 恒 true；mac 查 .app 路径；win 查 launcher 在 PATH。 */
export function detectInstalled(def: EditorDef, platform: Platform, deps: DetectDeps): boolean {
  if (def.kind === 'fileManager' || def.kind === 'terminal') return true
  if (platform === 'darwin' && def.mac) {
    const app = `${def.mac.appName}.app`
    return deps.existsSync(`/Applications/${app}`) || deps.existsSync(join(deps.home, 'Applications', app))
  }
  if (platform === 'win32' && def.win?.launcher) {
    return deps.which(def.win.launcher) != null
  }
  return false
}

/** 解析「怎么打开 absPath」。launcher 优先、open -a 兜底；Finder=shellOpenPath；Terminal=系统终端。 */
export function resolveOpen(def: EditorDef, platform: Platform, absPath: string, deps: OpenDeps): OpenAction {
  if (def.kind === 'fileManager') return { type: 'shellOpenPath' }
  if (def.kind === 'terminal') {
    if (platform === 'darwin') return { type: 'exec', file: 'open', args: ['-a', 'Terminal', absPath] }
    // win 终端：有 wt 用 wt -d，否则用 cmd 在该目录开
    return deps.which('wt')
      ? { type: 'exec', file: 'wt', args: ['-d', absPath] }
      : { type: 'exec', file: 'cmd', args: ['/c', 'start', 'cmd', '/k', `cd /d "${absPath}"`] }
  }
  // editor
  if (platform === 'darwin' && def.mac) {
    if (def.mac.launcher && deps.which(def.mac.launcher)) return { type: 'exec', file: def.mac.launcher, args: [absPath] }
    return { type: 'exec', file: 'open', args: ['-a', def.mac.appName, absPath] }
  }
  if (platform === 'win32' && def.win?.launcher) {
    return { type: 'exec', file: def.win.launcher, args: [absPath] }
  }
  return { type: 'shellOpenPath' }   // 理论不可达（detect 已挡），兜底
}

/** 默认依赖（真实 fs/PATH）。 */
export const defaultDetectDeps: DetectDeps = { existsSync, home: homedir(), which: whichOnPath }
export const defaultOpenDeps: OpenDeps = { which: whichOnPath }
