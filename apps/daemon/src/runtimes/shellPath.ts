import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { sortNodeVersionDirsDesc } from './detection'

// macOS/Linux 上从 Dock/Finder/launchd 启动的 GUI 进程只继承精简 PATH（/usr/bin:/bin:/usr/sbin:/sbin），
// 不含 nvm/homebrew/node。CLI 检测能靠候选目录兜底找到二进制，但很多安装是 `#!/usr/bin/env node` 的
// JS 脚本，运行时仍需 PATH 上有 node，否则 `env: node: No such file or directory`。这里在 daemon 启动时
// 把真实 PATH 补回来，让检测与会话子进程都能找到 node。

export interface ShellPathDeps {
  platform: NodeJS.Platform
  shell: string | undefined
  home: string
  runShell: (shell: string, args: string[]) => string
  listDir: (p: string) => string[]
}

function realDeps(): ShellPathDeps {
  return {
    platform: process.platform,
    shell: process.env.SHELL,
    home: os.homedir(),
    // -ilc：交互式登录 shell，确保加载 ~/.zprofile/.zshrc（nvm/brew 通常在这里改 PATH）。
    // 5s 超时 + 调用方 try/catch，慢/坏 shell 不拖垮启动。
    runShell: (shell, args) => execFileSync(shell, args, { encoding: 'utf8', timeout: 5000 }),
    listDir: (p) => { try { return fs.readdirSync(p) } catch { return [] } },
  }
}

const MARK = '__AGENT_SHELL_PATH__'

/** 跑登录 shell 取真实 PATH。win32（GUI 正常继承用户 PATH）/ 失败 / 超时 / 空 → null（fail-soft）。 */
export function resolveLoginShellPath(deps: ShellPathDeps = realDeps()): string | null {
  if (deps.platform === 'win32') return null
  const shell = deps.shell || '/bin/zsh'
  try {
    const out = deps.runShell(shell, ['-ilc', `printf %s "${MARK}\${PATH}${MARK}"`])
    const m = out.match(new RegExp(`${MARK}([\\s\\S]*?)${MARK}`))
    const p = m?.[1]?.trim()
    return p ? p : null
  } catch {
    return null
  }
}

/** node 常见安装目录兜底：nvm 各版本 bin + homebrew + ~/.local/bin。即便登录 shell 取不到也保证 node 在 PATH。 */
function fallbackDirs(deps: ShellPathDeps): string[] {
  const dirs: string[] = []
  const nvmRoot = path.join(deps.home, '.nvm', 'versions', 'node')
  // 按 node 版本号降序（新版在前）：登录解析失败时，augmented PATH 也优先放最新版 bin，
  // 让 detection 的 PATH 优先检索天然命中最新 CLI（与 detection.ts candidateDirs 一致）。
  for (const ver of sortNodeVersionDirsDesc(deps.listDir(nvmRoot))) dirs.push(path.join(nvmRoot, ver, 'bin'))
  dirs.push('/opt/homebrew/bin', '/usr/local/bin', path.join(deps.home, '.local', 'bin'))
  return dirs
}

/**
 * 合并增强 PATH：登录 shell PATH 优先 → node 安装目录兜底 → 原 PATH 兜底；去重去空，保序。
 * win32 原样返回 currentPath（不做增强）。
 */
export function augmentedPath(currentPath: string | undefined, deps: ShellPathDeps = realDeps()): string {
  if (deps.platform === 'win32') return currentPath ?? ''
  const parts: string[] = []
  const login = resolveLoginShellPath(deps)
  if (login) for (const d of login.split(path.delimiter)) parts.push(d)
  for (const d of fallbackDirs(deps)) parts.push(d)
  for (const d of (currentPath ?? '').split(path.delimiter)) parts.push(d)
  return [...new Set(parts.filter(Boolean))].join(path.delimiter)
}
