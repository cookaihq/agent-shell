// Phase 0 Task 0.4 探测：起 codex 0.137 app-server，真 spawn 并行子代理，抓真实事件流。
// 用法：node apps/daemon/tests/codex-probe/probe-subagent.mjs
// 依据 baseline 0.137 协议：initialize → thread/start → turn/start(并行 subagent prompt) → 收 notification。
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const OUT_DIR = path.dirname(new URL(import.meta.url).pathname)
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-probe-'))
const rawLog = fs.createWriteStream(path.join(OUT_DIR, 'subagent.raw.jsonl'))
console.error('[probe] cwd =', cwd)

const child = spawn('npx', ['-y', '@openai/codex@0.137.0', 'app-server',
  '-c', 'enable_fanout=true', '-c', 'multi_agent_v2=true'], {
  cwd, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'],
})
let nextId = 1
const pending = new Map()
function send(method, params) {
  const id = nextId++
  const msg = { method, id, params: params ?? null }
  child.stdin.write(JSON.stringify(msg) + '\n')
  console.error('[→]', method, JSON.stringify(params)?.slice(0, 120))
  return new Promise((res, rej) => pending.set(id, { res, rej, method }))
}
function respond(id, result) { child.stdin.write(JSON.stringify({ id, result }) + '\n') }

// 统计
const threads = new Map()  // threadId → {source}
const collabEvents = []

let buf = ''
child.stdout.on('data', (d) => {
  buf += d.toString()
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
    if (!line.trim()) continue
    rawLog.write(line + '\n')
    let m; try { m = JSON.parse(line) } catch { console.error('[!parse]', line.slice(0, 200)); continue }
    // response
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined) && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      if (m.error) { console.error('[←err]', p.method, JSON.stringify(m.error).slice(0, 200)); p.rej(m.error) }
      else { console.error('[←ok]', p.method, JSON.stringify(m.result)?.slice(0, 160)); p.res(m.result) }
      continue
    }
    // server→client request（有 method + id）：best-effort 自动放行/空响应
    if (m.method && m.id !== undefined) {
      console.error('[⇐req]', m.method, JSON.stringify(m.params)?.slice(0, 200))
      // 审批类请求统一放行；其它给空对象
      const lower = m.method.toLowerCase()
      const result = lower.includes('approv') || lower.includes('permission') ? { decision: 'approved' } : {}
      respond(m.id, result)
      continue
    }
    // notification（method，无 id）
    if (m.method) {
      const p = m.params || {}
      if (m.method === 'thread/started') {
        threads.set(p.threadId ?? p.thread?.id, p.threadSource ?? p.source ?? '?')
        console.error('[◆ thread/started]', p.threadId ?? p.thread?.id, 'source=', JSON.stringify(p.threadSource ?? p.source))
      } else if (m.method === 'item/started' || m.method === 'item/completed') {
        const it = p.item || {}
        const tid = p.threadId
        if (it.type === 'collabAgentToolCall') {
          collabEvents.push({ ev: m.method, tool: it.tool, status: it.status, sender: it.senderThreadId, receivers: it.receiverThreadIds, states: it.agentsStates })
          console.error('[★ collabAgentToolCall]', m.method, 'tool=', it.tool, 'status=', it.status, 'sender=', it.senderThreadId, 'receivers=', JSON.stringify(it.receiverThreadIds), 'states=', JSON.stringify(it.agentsStates))
        } else {
          console.error('  [item]', m.method, 'thread=', tid, 'type=', it.type, (it.text ?? it.command ?? '').toString().slice(0, 60))
        }
      } else if (m.method === 'turn/completed') {
        console.error('[◆ turn/completed]', 'thread=', p.threadId, 'usage=', JSON.stringify(p.usage)?.slice(0, 120))
        if (p.threadId === mainThreadId) { console.error('[probe] 主 thread turn 完成 → 3s 后收尾'); setTimeout(finish, 3000) }
      } else if (m.method === 'error') {
        console.error('[◆ error]', JSON.stringify(p).slice(0, 200))
      } else {
        console.error('  ·', m.method, JSON.stringify(p)?.slice(0, 80))
      }
      continue
    }
  }
})
child.stderr.on('data', (d) => process.stderr.write('[srv] ' + d))
child.on('exit', (c) => { console.error('[probe] app-server exit', c); finish() })

let mainThreadId
async function run() {
  await send('initialize', { clientInfo: { name: 'agent-shell-probe', title: null, version: '0.0.1' }, capabilities: { experimentalApi: true, requestAttestation: false } })
  // 校验 fanout/multi_agent 经 -c 开了没
  const feats = await send('experimentalFeature/list', {})
  const want = (feats?.data ?? []).filter((f) => ['multi_agent', 'multi_agent_v2', 'enable_fanout'].includes(f.name))
  console.error('[probe] 特性态:', want.map((f) => `${f.name}=${f.enabled}`).join(', '))
  const ts = await send('thread/start', { cwd, approvalPolicy: 'never', sandbox: 'danger-full-access' })
  mainThreadId = ts?.thread?.id ?? ts?.threadId
  console.error('[probe] main thread =', mainThreadId, 'model=', ts?.model, 'provider=', ts?.modelProvider)
  const prompt = '你必须使用「spawn agent / 子代理」工具（multi-agent fanout），不要自己直接干。'
    + '请用该工具同时 spawn 两个并行子代理：'
    + '子代理 A（角色 file-writer-A）：在当前目录创建文件 AAA.txt，内容恰好是 AAA-from-subagent；'
    + '子代理 B（角色 file-writer-B）：创建文件 BBB.txt，内容恰好是 BBB-from-subagent。'
    + '务必通过 spawn 子代理工具并行派发（fanout），再 wait 等两个都完成，最后汇总。这是测试子代理编排能力，请一定用子代理工具。'
  await send('turn/start', { threadId: mainThreadId, input: [{ type: 'text', text: prompt, text_elements: [] }] })
  console.error('[probe] turn/start 已发，等事件流（最多 150s）…')
}

let finished = false
function finish() {
  if (finished) return; finished = true
  console.error('\n========== 探测小结 ==========')
  console.error('线程数:', threads.size, [...threads.entries()].map(([id, s]) => `${id.slice(0,8)}(${JSON.stringify(s)})`).join(', '))
  console.error('collabAgentToolCall 事件数:', collabEvents.length)
  for (const e of collabEvents) console.error('  -', e.ev, e.tool, e.status, 'recv=', JSON.stringify(e.receivers), 'states=', JSON.stringify(e.states))
  console.error('创建的文件:', fs.readdirSync(cwd).filter((f) => f.endsWith('.txt')))
  console.error('原始事件流已存:', path.join(OUT_DIR, 'subagent.raw.jsonl'))
  try { child.kill('SIGTERM') } catch {}
  rawLog.end()
  setTimeout(() => process.exit(0), 500)
}

run().catch((e) => { console.error('[probe] run 失败', e); finish() })
setTimeout(() => { console.error('[probe] 超时 150s，收尾'); finish() }, 150000)
