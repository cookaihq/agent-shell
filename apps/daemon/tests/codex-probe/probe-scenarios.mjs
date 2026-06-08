// Phase 0 探测（Part A）：起 codex 0.137 app-server 抓多场景真实事件流。
// 用法：node apps/daemon/tests/codex-probe/probe-scenarios.mjs <scenario>
//   scenario ∈ basic | sandbox | interrupt | approval
// 每个场景把原始 JSON-RPC 报文逐行落到 apps/daemon/src/runtimes/codex/__fixtures__/<name>.jsonl
// 依据 baseline 0.137 协议：initialize → thread/start → turn/start → 收 notification。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const scenario = process.argv[2]
const SCENARIOS = {
  basic: {
    file: 'basic-conversation.jsonl',
    approvalPolicy: 'never',
    sandbox: 'workspace-write',
    prompt: '请在当前目录创建文件 hello.txt，内容恰好是一行：hi-from-codex。创建后用一句话确认完成。',
    autoApprove: false,
  },
  sandbox: {
    file: 'sandbox-readonly.jsonl',
    approvalPolicy: 'never',
    sandbox: 'read-only',
    prompt: '请在当前目录创建文件 blocked.txt，内容写 should-not-exist。如果写入被沙箱拒绝，请如实说明失败原因。',
    autoApprove: false,
  },
  interrupt: {
    file: 'interrupt.jsonl',
    approvalPolicy: 'never',
    sandbox: 'workspace-write',
    // 跑一个会持续一会的命令，中途 turn/interrupt
    prompt: '请运行一个 shell 命令：sleep 30 && echo done。运行它，不要跳过。',
    interruptAfterMs: 6000,
    autoApprove: false,
  },
  approval: {
    file: 'approval.jsonl',
    // on-request + read-only：模型写文件必须升级 → 触发 server→client 审批 request
    approvalPolicy: 'on-request',
    sandbox: 'read-only',
    prompt: '请用 shell 命令 `echo approval-probe > approved.txt` 在当前目录创建文件 approved.txt。当前是只读沙箱，你需要请求升级权限来执行写入；请发起该命令并请求批准。',
    autoApprove: true, // 捕获审批 request 后自动放行（v2 decision=accept）
  },
}

const cfg = SCENARIOS[scenario]
if (!cfg) {
  console.error('未知场景。用法: node probe-scenarios.mjs <basic|sandbox|interrupt|approval>')
  process.exit(2)
}

const FIX_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/runtimes/codex/__fixtures__')
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), `codex-probe-${scenario}-`))
const outPath = path.join(FIX_DIR, cfg.file)
const rawLog = fs.createWriteStream(outPath)
console.error(`[probe:${scenario}] cwd =`, cwd, '→', outPath)

const child = spawn('npx', ['-y', '@openai/codex@0.137.0', 'app-server'], {
  cwd, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'],
})
let nextId = 1
const pending = new Map()
function send(method, params) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ method, id, params: params ?? null }) + '\n')
  console.error('[→]', method, JSON.stringify(params)?.slice(0, 120))
  return new Promise((res, rej) => pending.set(id, { res, rej, method }))
}
function respond(id, result) { child.stdin.write(JSON.stringify({ id, result }) + '\n') }

let mainThreadId
let currentTurnId
let buf = ''
let approvalSeen = false
child.stdout.on('data', (d) => {
  buf += d.toString()
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
    if (!line.trim()) continue
    rawLog.write(line + '\n')
    let m; try { m = JSON.parse(line) } catch { console.error('[!parse]', line.slice(0, 200)); continue }
    // response to our request
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined) && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      if (m.error) { console.error('[←err]', p.method, JSON.stringify(m.error).slice(0, 200)); p.rej(m.error) }
      else { console.error('[←ok]', p.method, JSON.stringify(m.result)?.slice(0, 160)); p.res(m.result) }
      continue
    }
    // server→client request (method + id)
    if (m.method && m.id !== undefined) {
      console.error('[⇐req]', m.method, JSON.stringify(m.params)?.slice(0, 240))
      const lower = m.method.toLowerCase()
      const isApproval = lower.includes('approv') || lower.includes('permission')
      if (isApproval) {
        approvalSeen = true
        console.error('[★ APPROVAL REQ]', m.method, JSON.stringify(m.params))
        // v2 决策枚举 = accept | acceptForSession | decline | cancel（非 approved/denied）
        respond(m.id, { decision: cfg.autoApprove ? 'accept' : 'decline' })
      } else {
        respond(m.id, {})
      }
      continue
    }
    // notification
    if (m.method) {
      const p = m.params || {}
      if (m.method === 'thread/started') {
        mainThreadId ??= p.threadId ?? p.thread?.id
        console.error('[◆ thread/started]', p.threadId ?? p.thread?.id)
      } else if (m.method === 'item/started' || m.method === 'item/completed') {
        const it = p.item || {}
        console.error('  [item]', m.method, 'type=', it.type, (it.text ?? it.command ?? '').toString().slice(0, 60))
      } else if (m.method === 'turn/started') {
        currentTurnId = p.turnId ?? p.turn?.id
        console.error('[◆ turn/started] turnId=', currentTurnId)
      } else if (m.method === 'turn/completed') {
        console.error('[◆ turn/completed] usage=', JSON.stringify(p.usage)?.slice(0, 120))
        setTimeout(finish, 1500)
      } else if (m.method === 'turn/failed' || m.method === 'error') {
        console.error('[◆', m.method, ']', JSON.stringify(p).slice(0, 200))
        setTimeout(finish, 1500)
      } else {
        console.error('  ·', m.method, JSON.stringify(p)?.slice(0, 80))
      }
      continue
    }
  }
})
child.stderr.on('data', (d) => process.stderr.write('[srv] ' + d))
child.on('exit', (c) => { console.error('[probe] app-server exit', c); finish() })

async function run() {
  await send('initialize', { clientInfo: { name: 'agent-shell-probe', title: null, version: '0.0.1' }, capabilities: { experimentalApi: true, requestAttestation: false } })
  const ts = await send('thread/start', { cwd, approvalPolicy: cfg.approvalPolicy, sandbox: cfg.sandbox })
  mainThreadId = ts?.thread?.id ?? ts?.threadId
  console.error('[probe] main thread =', mainThreadId, 'model=', ts?.model, 'provider=', ts?.modelProvider)
  const turnP = send('turn/start', { threadId: mainThreadId, input: [{ type: 'text', text: cfg.prompt, text_elements: [] }] })
  if (cfg.interruptAfterMs) {
    setTimeout(async () => {
      console.error(`[probe] ${cfg.interruptAfterMs}ms 到，发 turn/interrupt turnId=${currentTurnId}`)
      try { await send('turn/interrupt', { threadId: mainThreadId, turnId: currentTurnId }) } catch (e) { console.error('interrupt err', JSON.stringify(e)) }
      setTimeout(finish, 2500)
    }, cfg.interruptAfterMs)
  }
  await turnP.catch((e) => console.error('[probe] turn/start err', JSON.stringify(e).slice(0, 200)))
  console.error('[probe] turn/start 已发，等事件流…')
}

let finished = false
function finish() {
  if (finished) return; finished = true
  console.error(`\n[probe:${scenario}] 收尾。approvalSeen=${approvalSeen}。文件:`, fs.readdirSync(cwd).filter((f) => !f.startsWith('.')))
  console.error('原始事件流:', outPath)
  try { child.kill('SIGTERM') } catch {}
  rawLog.end()
  setTimeout(() => process.exit(0), 500)
}

run().catch((e) => { console.error('[probe] run 失败', e); finish() })
setTimeout(() => { console.error('[probe] 超时 120s，收尾'); finish() }, 120000)
