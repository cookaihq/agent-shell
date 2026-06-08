// Phase 0 Task 0.5：探 codex app-server 鉴权读取方法（getAuthStatus / account/get）+ 校验 -c provider 覆盖。
// 只读，不触发真实 OAuth。用法：node apps/daemon/tests/codex-probe/probe-auth.mjs
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const FIX_DIR = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../../src/runtimes/codex/__fixtures__')
const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'codex-probe-auth-'))
const rawLog = fs.createWriteStream(path.join(FIX_DIR, 'auth-provider.jsonl'))

// 用 -c 覆盖 provider 来验证「-c 注入」可行性（覆盖 base_url，看 thread/start 是否反映）
const child = spawn('npx', ['-y', '@openai/codex@0.137.0', 'app-server',
  '-c', 'model_provider=foxapi',
  '-c', 'model_providers.foxapi.base_url="https://api.foxapi.cc/v1"',
], { cwd, env: { ...process.env }, stdio: ['pipe', 'pipe', 'pipe'] })

let nextId = 1
const pending = new Map()
function send(method, params) {
  const id = nextId++
  child.stdin.write(JSON.stringify({ method, id, params: params ?? null }) + '\n')
  console.error('[→]', method, JSON.stringify(params)?.slice(0, 120))
  return new Promise((res, rej) => pending.set(id, { res, rej, method }))
}
let buf = ''
child.stdout.on('data', (d) => {
  buf += d.toString()
  let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1)
    if (!line.trim()) continue
    rawLog.write(line + '\n')
    let m; try { m = JSON.parse(line) } catch { continue }
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined) && pending.has(m.id)) {
      const p = pending.get(m.id); pending.delete(m.id)
      if (m.error) { console.error('[←err]', p.method, JSON.stringify(m.error)); p.rej(m.error) }
      else { console.error('[←ok]', p.method, JSON.stringify(m.result)); p.res(m.result) }
    }
  }
})
child.stderr.on('data', (d) => process.stderr.write('[srv] ' + d))

// 探多个候选鉴权方法名（best-effort，错的会 -err 但不致命）
async function tryMethod(method, params) {
  try { const r = await send(method, params); return { method, ok: true, r } }
  catch (e) { return { method, ok: false, e } }
}

async function run() {
  await send('initialize', { clientInfo: { name: 'agent-shell-probe', title: null, version: '0.0.1' }, capabilities: { experimentalApi: true, requestAttestation: false } })
  // v1 风格
  await tryMethod('getAuthStatus', { includeToken: false, refreshToken: false })
  // v2 account 读取（候选）
  await tryMethod('account/get', {})
  await tryMethod('account/rateLimits/get', {})
  // 验证 provider 覆盖：thread/start 反映哪个 provider/base_url
  const ts = await tryMethod('thread/start', { cwd, approvalPolicy: 'never', sandbox: 'read-only' })
  console.error('[probe] thread/start provider 反映:', JSON.stringify({ model: ts?.r?.model, modelProvider: ts?.r?.modelProvider }))
  setTimeout(finish, 800)
}
let finished = false
function finish() { if (finished) return; finished = true; try { child.kill('SIGTERM') } catch {}; rawLog.end(); setTimeout(() => process.exit(0), 400) }
run().catch((e) => { console.error('run err', e); finish() })
setTimeout(() => { console.error('超时'); finish() }, 30000)
