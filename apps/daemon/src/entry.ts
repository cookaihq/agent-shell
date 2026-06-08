import { boot } from './boot'
import { augmentedPath } from './runtimes/shellPath'

// GUI（Dock/Finder/launchd）启动只继承精简 PATH，缺 node/nvm/homebrew → CLI 检测能找到文件但 JS 脚本类
// 安装跑 `--version`/会话时报 `env: node: No such file or directory`。启动第一件事补回真实 PATH，
// 让后续检测与引擎子进程都能找到 node。放 entry（真实进程入口），boot() 不碰——测试直接调 boot 不受影响。
process.env.PATH = augmentedPath(process.env.PATH)

// 可执行 daemon 入口：被 desktop 主进程用 ELECTRON_RUN_AS_NODE spawn。
// webDir / namespace / builtinSkillsDir 经环境变量注入；端口 0 随机，真实 URL 经 sidecar 发布。
const webDir = process.env.AGENT_SHELL_WEB_DIR || undefined
const namespace = process.env.AGENT_SHELL_NAMESPACE || 'default'
const authSecret = process.env.AGENT_SHELL_AUTH_SECRET || undefined
const builtinSkillsDir = process.env.AGENT_SHELL_BUILTIN_SKILLS_DIR || undefined
const builtinAutomationsDir = process.env.AGENT_SHELL_BUILTIN_AUTOMATIONS_DIR || undefined
const automationMcpEntry = process.env.AGENT_SHELL_AUTOMATION_MCP_ENTRY || undefined

const handle = await boot({ port: 0, webDir, namespace, authSecret, builtinSkillsDir, builtinAutomationsDir, automationMcpEntry, seedDefaults: true })
// stderr 打一行便于排障；真实地址以 sidecar 为准（不靠解析 stdout）。
console.error(`[daemon-entry] ready url=${handle.daemon.url} sidecar=${handle.sidecar.socketPath}`)

let stopping = false
const shutdown = async () => {
  if (stopping) return
  stopping = true
  try { await handle.stop() } finally { process.exit(0) }
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
