#!/usr/bin/env node
/**
 * 每周检查 open-design 的 Markdown 渲染器（runtime/markdown.tsx）是否有上游更新。
 *
 * 由本项目 .claude/settings.json 的 SessionStart hook 调用：每次在本项目里打开
 * Claude Code 会话时触发，但用一个时间戳文件做 7 天节流——没满 7 天直接静默退出。
 *
 * 行为：满 7 天后，git pull 本地 open-design 克隆 → 对比上游 markdown.tsx 与本仓
 * vendored 版本。一致则静默；不一致则把「上游有更新」的提示打到 stdout
 * （SessionStart hook 的 stdout 会被注入会话上下文，让 Claude 据此提醒用户）。
 *
 * 设计原则：
 *   - 「只通知」，绝不自动覆盖 vendored 文件（同步需人确认 + 跑 typecheck）。
 *   - 永不抛错、永远 exit 0（SessionStart 本就无法阻断会话，且不该因检查失败干扰用户）。
 *   - 一致 / 未到期 / 无法检查 时保持 stdout 干净，避免噪音。
 *
 * 详见 apps/renderer/src/runtime/VENDORED.md。
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const UPSTREAM = resolve(ROOT, 'tmp/open-design/apps/web/src/runtime/markdown.tsx')
const VENDORED = resolve(ROOT, 'apps/renderer/src/runtime/markdown.tsx')
const STAMP = resolve(ROOT, 'tmp/.open-design-md-sync-last-check')
const OPEN_DESIGN_DIR = resolve(ROOT, 'tmp/open-design')
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000

function main() {
  // 1) 7 天节流：未到期直接静默退出（零开销）。
  if (existsSync(STAMP)) {
    const age = Date.now() - statSync(STAMP).mtimeMs
    if (age < SEVEN_DAYS_MS) return
  }

  // 2) 没有本地 open-design 克隆就无法对比——静默退出（不打扰）。
  if (!existsSync(OPEN_DESIGN_DIR) || !existsSync(VENDORED)) {
    touchStamp()
    return
  }

  // 3) 尽力 pull 最新（离线 / 失败则用本地已有快照对比，best-effort）。
  try {
    execFileSync('git', ['-C', OPEN_DESIGN_DIR, 'pull', '--quiet', '--ff-only'], {
      stdio: 'ignore',
      timeout: 25_000,
    })
  } catch {
    // 忽略：拉取失败仍用本地快照对比，避免因网络问题报错。
  }

  // 4) 对比上游与 vendored。
  if (!existsSync(UPSTREAM)) {
    touchStamp()
    return
  }
  const upstream = readFileSync(UPSTREAM, 'utf8')
  const vendored = readFileSync(VENDORED, 'utf8')
  touchStamp()

  if (upstream === vendored) return // 一致：静默。

  // 5) 不一致：打提示到 stdout（会被注入会话上下文）。
  const upstreamCommit = safeCommit()
  process.stdout.write(
    [
      '⚠️ [open-design 同步检查] 参考实现的 Markdown 渲染器有上游更新。',
      `本仓 vendored 文件 apps/renderer/src/runtime/markdown.tsx 与上游 ${upstreamCommit} 不一致。`,
      '请提醒用户：open-design 的 markdown.tsx 已更新，是否同步？',
      '同步步骤见 apps/renderer/src/runtime/VENDORED.md（覆盖文件 → pnpm -C apps/renderer build → 按需补 i18n/CSS）。',
      '注意：这是「只通知」机制，不要自动覆盖，需用户确认后再同步。',
    ].join('\n') + '\n',
  )
}

function touchStamp() {
  try {
    writeFileSync(STAMP, new Date().toISOString() + '\n')
  } catch {
    // 时间戳写不进去也不影响主流程（下次会重新检查）。
  }
}

function safeCommit() {
  try {
    return execFileSync('git', ['-C', OPEN_DESIGN_DIR, 'rev-parse', '--short', 'HEAD'], {
      encoding: 'utf8',
      timeout: 5_000,
    }).trim()
  } catch {
    return '(commit 未知)'
  }
}

try {
  main()
} catch {
  // 兜底：检查脚本任何异常都不应干扰会话。
}
process.exit(0)
