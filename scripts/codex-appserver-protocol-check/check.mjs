#!/usr/bin/env node
/**
 * check-codex-appserver-protocol.mjs — 独立运维脚本（开发者用，不进应用代码）
 *
 * 作用：检测「比 agent-shell 适配的 baseline 更新的 codex 版本」的 app-server 协议有没有变化，
 *       判断新版本是否需要为 agent-shell 重新适配。是设计 §4.11「schema 契约快照 diff」的落地。
 *
 * 背景：app-server 是 experimental 协议、无版本号、无兼容承诺。codex 自带
 *       `codex app-server generate-ts` 能导出完整协议类型；把某个锁定版本的导出当作 baseline，
 *       新版本导出后与之 diff，就能机器看出哪个 method / ThreadItem / 字段变了。
 *
 * 用法：
 *   node scripts/codex-appserver-protocol-check/check.mjs --init [--version <v>]
 *        建立/更新 baseline 快照。默认用本机 codex；--version 用 npx 下载指定版本。
 *   node scripts/codex-appserver-protocol-check/check.mjs
 *        检测：查 npm 最新 stable codex；若与 baseline 版本不同，导出其协议与 baseline diff（会 npx 下载该版本）。
 *   node scripts/codex-appserver-protocol-check/check.mjs --against <v>
 *        对指定版本（npx 下载）与 baseline diff。
 *   node scripts/codex-appserver-protocol-check/check.mjs --against local
 *        对本机 codex 与 baseline diff（自检，不下载）。
 *
 * 退出码：0 = 无需适配（无新版 / 协议无变化）；1 = 协议有变化、需 review 适配；2 = 运行错误。
 *
 * 挂进 agent-shell 定时任务：建一个定时任务，prompt 形如
 *   「运行 `node scripts/codex-appserver-protocol-check/check.mjs` 并把结论告诉我」，
 *   让 agent 用 Bash 跑本脚本、读退出码与输出，定期汇报 codex 新版本是否需要适配。
 */
import { spawnSync, execSync } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BASELINE = path.join(HERE, 'baseline.txt')

// agent-shell app-server 客户端依赖的核心协议类型——这些一旦变化尤其要警惕（务必人工 review）。
const CRITICAL = [
  'ClientRequest', 'ServerNotification', 'InitializeParams', 'InitializeResponse',
  'ThreadStartParams', 'TurnStartParams', 'ThreadItem', 'UserInput', 'AskForApproval',
  'SandboxMode', 'SandboxPolicy', 'ReasoningEffort',
  'CollabAgentTool', 'CollabAgentState', 'CollabAgentStatus', 'CollabAgentToolCallStatus',
  'SubAgentSource', 'ThreadSource', 'ItemStartedNotification', 'ItemCompletedNotification',
]

function die(msg, code = 2) { console.error('✗ ' + msg); process.exit(code) }
function hasLocalCodex() { try { execSync('codex --version', { stdio: 'ignore' }); return true } catch { return false } }
function localVersion() { return execSync('codex --version').toString().match(/\d+\.\d+\.\d+\S*/)?.[0] ?? 'unknown' }
function npmLatest() { return execSync('npm view @openai/codex version', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() }

/** 导出某 codex 的 app-server 协议，合并所有 .ts 成单个「按相对路径排序」的快照字符串。 */
function exportSnapshot(version) {
  const out = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-proto-'))
  const useLocal = !version || version === 'local'
  const [bin, args] = useLocal
    ? ['codex', ['app-server', 'generate-ts', '--out', out]]
    : ['npx', ['-y', `@openai/codex@${version}`, 'app-server', 'generate-ts', '--out', out]]
  const r = spawnSync(bin, args, { stdio: ['ignore', 'ignore', 'inherit'] })
  if (r.status !== 0) die(`导出协议失败（${useLocal ? '本机' : version}）。npx 路径需联网下载该版本。`)
  const files = []
  ;(function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (e.name.endsWith('.ts')) files.push(p)
    }
  })(out)
  files.sort()
  const parts = files.map((f) => {
    const rel = path.relative(out, f)
    const body = fs.readFileSync(f, 'utf8').split('\n')
      .filter((l) => !/GENERATED CODE|ts-rs|DO NOT MODIFY/.test(l)).join('\n').trim()
    return `///// ${rel} /////\n${body}`
  })
  fs.rmSync(out, { recursive: true, force: true })
  return parts.join('\n\n')
}

function parseSnapshot(text) {
  const map = new Map()
  for (const block of text.split(/^\/\/\/\/\/ /m)) {
    const m = block.match(/^(\S+) \/\/\/\/\/\n([\s\S]*)$/)
    if (m) map.set(m[1], m[2].trim())
  }
  return map
}

function reportDiff(baseText, newText, newVer) {
  const a = parseSnapshot(baseText), b = parseSnapshot(newText)
  const added = [...b.keys()].filter((k) => !a.has(k))
  const removed = [...a.keys()].filter((k) => !b.has(k))
  const changed = [...b.keys()].filter((k) => a.has(k) && a.get(k) !== b.get(k))
  if (!added.length && !removed.length && !changed.length) {
    console.log(`✓ codex ${newVer} 的 app-server 协议与 baseline 完全一致，可直接支持，无需适配。`)
    return 0
  }
  const isCritical = (f) => CRITICAL.some((c) => f === `${c}.ts` || f.endsWith(`/${c}.ts`))
  const crit = [...added, ...removed, ...changed].filter(isCritical)
  console.log(`⚠️  codex ${newVer} 的 app-server 协议相对 baseline 有变化，需 review 是否适配：`)
  if (added.length) console.log(`  + 新增 ${added.length} 类型：${added.slice(0, 12).join(', ')}${added.length > 12 ? ' …' : ''}`)
  if (removed.length) console.log(`  - 移除 ${removed.length} 类型：${removed.slice(0, 12).join(', ')}${removed.length > 12 ? ' …' : ''}`)
  if (changed.length) console.log(`  ~ 改动 ${changed.length} 类型：${changed.slice(0, 12).join(', ')}${changed.length > 12 ? ' …' : ''}`)
  if (crit.length) {
    console.log(`\n  🔴 其中 ${crit.length} 个是 agent-shell 客户端依赖的核心协议，务必人工检查：`)
    console.log(`     ${crit.join(', ')}`)
  } else {
    console.log(`\n  🟢 agent-shell 依赖的核心协议未变（变化都在外围类型），多半靠防御性解析即可吸收。`)
  }
  return 1
}

// ── 主流程 ──
const argv = process.argv.slice(2)
const opt = (name) => { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] ?? true) : undefined }

if (argv.includes('--init')) {
  const v = opt('--version')
  const useLocal = !v || v === true
  if (useLocal && !hasLocalCodex()) die('未检测到本机 codex；--init 需本机 codex，或用 --version <v> 指定版本（npx 下载）')
  const ver = useLocal ? localVersion() : v
  console.log(`建立 baseline：codex ${ver}…`)
  const snap = exportSnapshot(useLocal ? 'local' : v)
  fs.writeFileSync(BASELINE, `// baseline: codex ${ver}\n${snap}\n`)
  console.log(`✓ baseline 已写入 ${path.relative(process.cwd(), BASELINE)}（codex ${ver}，${parseSnapshot(snap).size} 个协议类型）`)
  process.exit(0)
}

if (!fs.existsSync(BASELINE)) die('无 baseline，请先跑：node scripts/codex-appserver-protocol-check/check.mjs --init')
const baseText = fs.readFileSync(BASELINE, 'utf8')
const baseVer = baseText.match(/baseline: codex (\S+)/)?.[1] ?? 'unknown'

const against = opt('--against')
if (against) {
  const ver = against === true ? 'local' : against
  console.log(`对比 codex ${ver === 'local' ? '本机' : ver} vs baseline ${baseVer}…`)
  process.exit(reportDiff(baseText, exportSnapshot(ver), ver === 'local' ? localVersion() : ver))
}

// 默认 check：查 npm latest stable
const latest = npmLatest()
console.log(`baseline=codex ${baseVer}，npm latest=codex ${latest}`)
if (latest === baseVer) { console.log('✓ 已是 baseline 版本，无需检查。'); process.exit(0) }
console.log(`版本不同 → 导出 codex ${latest} 协议比对（npx 下载该版本，需联网）…`)
process.exit(reportDiff(baseText, exportSnapshot(latest), latest))
