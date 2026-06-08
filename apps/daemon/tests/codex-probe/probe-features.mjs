// 快速探测：列出 codex 0.137 app-server 的实验特性 + 模型列表 + 配置，找 subagent/AgentControl 开关。
import { spawn } from 'node:child_process'
const child = spawn('npx', ['-y', '@openai/codex@0.137.0', 'app-server'], { stdio: ['pipe', 'pipe', 'pipe'] })
let nextId = 1; const pending = new Map()
function send(method, params) { const id = nextId++; child.stdin.write(JSON.stringify({ method, id, params: params ?? null }) + '\n'); return new Promise((res) => pending.set(id, res)) }
let buf = ''
child.stdout.on('data', (d) => {
  buf += d.toString(); let nl
  while ((nl = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, nl); buf = buf.slice(nl + 1); if (!line.trim()) continue
    let m; try { m = JSON.parse(line) } catch { continue }
    if (m.id !== undefined && (m.result !== undefined || m.error !== undefined) && pending.has(m.id)) { pending.get(m.id)(m.error ? { __err: m.error } : m.result); pending.delete(m.id) }
  }
})
child.stderr.on('data', (d) => process.stderr.write('[srv] ' + d))
async function run() {
  await send('initialize', { clientInfo: { name: 'probe', title: null, version: '0.0.1' }, capabilities: { experimentalApi: true, requestAttestation: false } })
  const feats = await send('experimentalFeature/list', {})
  console.log('===== experimentalFeature/list =====')
  console.log(JSON.stringify(feats, null, 1))
  const models = await send('model/list', {})
  console.log('===== model/list =====')
  console.log(JSON.stringify(models, null, 1)?.slice(0, 800))
  child.kill('SIGTERM'); setTimeout(() => process.exit(0), 300)
}
run().catch((e) => { console.error('fail', e); child.kill('SIGTERM'); process.exit(1) })
setTimeout(() => { console.error('timeout'); child.kill('SIGTERM'); process.exit(1) }, 40000)
