// Phase 9 真机 e2e：用「自带版 codex 二进制」+「真实 Phase 3 驱动 runCodexAppServerTurn」跑一轮真对话。
// 证明 resolveCodexBinary + codexAppServer 生命周期对真 app-server（非 fixture）端到端可用。
// 用法：node_modules/.bin/tsx apps/daemon/tests/codex-probe/e2e-driver.mts
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { runCodexAppServerTurn } from '../../src/runtimes/codex/codexAppServer.ts'
import { resolveCodexBinary } from '../../src/runtimes/codex/resolveBin.ts'

const bin = resolveCodexBinary()
console.error('[e2e] 自带版 codex:', bin.binPath, '| pathDir:', bin.pathDir)

const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-e2e-'))
const events: string[] = []
let finalMessage = ''
let resumeId: string | undefined

const handle = runCodexAppServerTurn({
  cwd,
  model: 'gpt-5.5',
  prompt: '请在当前目录创建文件 e2e.txt，内容恰好一行：codex-e2e-ok。创建后用一句话确认。',
  sandbox: 'workspace-write',
  approval: 'never',
  binPath: bin.binPath,
  pathDir: bin.pathDir,
  idleTimeoutMs: 90_000,
  onResumableId: (id) => { resumeId = id; console.error('[e2e] resumeId(threadId):', id) },
  onEvent: (ev) => {
    events.push(ev.type)
    if (ev.type === 'message' && !ev.streaming) finalMessage = ev.text
    if (ev.type === 'tool_use') console.error('[e2e] tool_use:', (ev as any).name, JSON.stringify((ev as any).input).slice(0, 80))
    if (ev.type === 'usage') console.error('[e2e] usage:', JSON.stringify(ev).slice(0, 140))
  },
  onTurnEnd: (stopReason) => {
    console.error('[e2e] turn_end:', stopReason)
    handle.endInput()
  },
})

handle.done.then(() => {
  const created = fs.existsSync(path.join(cwd, 'e2e.txt'))
  const content = created ? fs.readFileSync(path.join(cwd, 'e2e.txt'), 'utf8').trim() : '(无文件)'
  console.error('\n========== e2e 小结 ==========')
  console.error('事件类型序列:', [...new Set(events)].join(', '))
  console.error('含 message:', events.includes('message'), '| 含 turn_end:', events.includes('turn_end'), '| 含 usage:', events.includes('usage'))
  console.error('resumeId 拿到:', !!resumeId)
  console.error('e2e.txt 创建:', created, '| 内容:', content)
  console.error('末条 message:', finalMessage.slice(0, 120))
  const pass = events.includes('message') && events.includes('turn_end') && created && content === 'codex-e2e-ok'
  console.error('\n[e2e] 结果:', pass ? '✅ PASS（自带版二进制 + 真实驱动 端到端跑通真对话）' : '❌ FAIL')
  process.exit(pass ? 0 : 1)
})

setTimeout(() => { console.error('[e2e] 120s 超时'); process.exit(2) }, 120_000)
