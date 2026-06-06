import { cpSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'

// 发布镜像脚本（spec §5 发布镜像模型）：把私有仓按白名单清单快照到 release-mirror/，
// overlay 镜像专属资源（开源 README/LICENSE/.github），git 提交一次快照。**不 push**（无 remote 则打印指引）。

const ROOT = process.cwd()
const MIRROR = join(ROOT, 'release-mirror')
const ASSETS = join(ROOT, 'release-mirror-assets')

// 代码清单（白名单）。含 .npmrc——M8a 血泪：缺它镜像 clean install 后 @types/node 全线找不到、typecheck 崩。
// 不含 docs/（设计/计划文档不进镜像，spec §5）。
const MANIFEST = [
  'apps', 'packages',
  // scripts/ 必带：package.json 的 postinstall(rebuild-better-sqlite3-electron.mjs)
  // 与 test(vitest-electron.mjs) 都在此目录。缺它镜像 CI 的 pnpm install 会在 postinstall
  // 报「Cannot find module scripts/rebuild-better-sqlite3-electron.mjs」而整条流水线挂掉。
  'scripts',
  'package.json', 'pnpm-workspace.yaml', 'pnpm-lock.yaml',
  'tsconfig.json', 'tsconfig.base.json',
  'vitest.config.ts', 'vitest.workspace.ts',
  '.gitignore', '.npmrc',
]

// 拷贝时跳过的构建产物/依赖/杂物（按 basename）。
const SKIP = new Set(['node_modules', 'dist', 'web-dist', 'release', '.git', '.DS_Store'])
const filter = (src) => {
  const base = src.split('/').pop()
  if (SKIP.has(base)) return false
  if (base.endsWith('.tsbuildinfo')) return false
  return true
}

// 清空时保留的本地工作文件（非快照内容）：.git 历史 + 推送用的 token（由 root .gitignore 忽略，永不入库）。
const PRESERVE = new Set(['.git', '.github-token'])

// 1. 清 release-mirror 的非保留内容（保留独立仓历史 + 本地 token；无则建）
if (existsSync(MIRROR)) {
  for (const e of readdirSync(MIRROR)) {
    if (PRESERVE.has(e)) continue
    rmSync(join(MIRROR, e), { recursive: true, force: true })
  }
} else {
  mkdirSync(MIRROR, { recursive: true })
}

// 2. 拷清单
for (const item of MANIFEST) {
  const src = join(ROOT, item)
  if (!existsSync(src)) { console.warn(`[publish-mirror] 清单项不存在，跳过: ${item}`); continue }
  cpSync(src, join(MIRROR, item), { recursive: true, filter })
}

// 3. overlay 镜像专属资源（README/LICENSE/.github）
cpSync(ASSETS, MIRROR, { recursive: true })

// 4. git 快照（不 push）。时间戳由调用方传入（脚本不用 Date.now，保可重放）。
const stamp = process.argv[2] || 'snapshot'
const git = (...args) => execFileSync('git', args, { cwd: MIRROR, stdio: 'inherit' })
if (!existsSync(join(MIRROR, '.git'))) git('init')
git('add', '-A')
try {
  git('-c', 'user.name=cookaihq', '-c', 'user.email=cookai9@163.com', 'commit', '-m', `release snapshot ${stamp}`)
} catch {
  console.log('[publish-mirror] 无变更，跳过提交')
}

// 5. 下一步指引（脚本本身不 push——对外发布需用户授权）
let hasRemote = true
try { execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: MIRROR, stdio: 'ignore' }) } catch { hasRemote = false }
console.log('\n[publish-mirror] 镜像快照已生成于 release-mirror/。')
if (!hasRemote) {
  console.log('[publish-mirror] 该镜像仓尚无 remote。发布步骤（需你的公开 GitHub 仓）：')
  console.log('  cd release-mirror')
  console.log('  git remote add origin <你的公开镜像仓 git URL>')
  console.log('  git push -u origin HEAD:main')
  console.log('  git tag v<版本> && git push origin v<版本>   # 触发 Actions 构建 + Releases')
} else {
  console.log('[publish-mirror] 已有 remote。push 由你确认后手动执行（脚本不自动 push）。')
}
