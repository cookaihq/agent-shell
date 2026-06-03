import { startDaemon } from '@agent-shell/daemon'
import { createServer } from 'vite'
const daemon = await startDaemon({ port: 8787 })
console.log(`[dev] daemon → ${daemon.url}`)
const vite = await createServer()
await vite.listen(); vite.printUrls()
const shutdown = async () => { await vite.close(); await daemon.close(); process.exit(0) }
process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown)
