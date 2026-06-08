import http from 'node:http'
import path from 'node:path'
import { EventEmitter } from 'node:events'
import type { AddressInfo } from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import express from 'express'
import type Database from 'better-sqlite3'
import type { ApiError } from '@agent-shell/contracts'
import { AUTH_HEADER, AUTH_PENDING_CODE } from '@agent-shell/contracts'
import { detectEngines } from './runtimes/detection'
import { resolveCodexBinary } from './runtimes/codex/resolveBin'
import { openDatabase } from './db/database'
import { SessionRuntime } from './session/sessionRuntime'
import { createApiRouter } from './api/routes'
import { defaultProjectsDir, defaultSkillsDir, defaultAutomationsDir, configPath, channelDataDir, secretsPath, authStatePath, entityRequirementsPath, skillSourcesPath, skillSrcCacheDir, proxiesPath } from './paths'
import { makeConfigStore } from './config/store'
import { makeProviderStore, type ProviderStore } from './providers/store'
import { makeAuthSourceStore } from './auth/sourceStore'
import { makeProxyStore } from './proxy/store'
import { resolveActiveProxy } from './proxy/resolveProxy'
import { makeOAuthTokenStore } from './auth/oauthTokenStore'
import { detectClaudeLogin, type ClaudeLoginState } from './auth/claudeLoginDetect'
import { detectCodexLogin, type CodexLoginState } from './auth/codexLoginDetect'
import { runCodexLogin, type CodexLoginParams, type CodexLoginResult } from './auth/codexLogin'
import { makeSecretStore } from './secrets/store'
import { makeEntityRequirementStore } from './skills/entityRequirements'
import { resolveSkillEnv } from './skills/secretsResolve'
import { materializeSkillFiles } from './skills/materializeFiles'
import { listInjectedSkills } from './skills/injected'
import { makeSkillService } from './skills/service'
import { makeCliToolService } from './clitools/service'
import { seedDefaults } from './skills/seed'
import { AutomationScheduler } from './automation/scheduler'
import { makeAutomationStore } from './automation/automationStore'
import { materializeBuiltinAutomations } from './automation/builtinAutomations'
import { createAutomationToolHandler } from './automation/createAutomationTool'
import { makeAutomationRunHandler, type AutomationRunDone } from './automation/runHandler'

declare module 'express-serve-static-core' {
  interface Request {
    isApi?: boolean
  }
}

const apiErr = (code: string, message: string): ApiError => ({ error: { code, message } })

export interface DaemonServer {
  url: string
  port: number
  close: () => Promise<void>
}

export interface StartDaemonOptions {
  port?: number
  /** 注入引擎检测（测试用）；缺省用真实 detectEngines。 */
  detect?: typeof detectEngines
  db?: Database.Database
  runtime?: SessionRuntime
  projectsDir?: string
  skillsDir?: string
  /** 测试注入：自动任务库目录；缺省用 defaultAutomationsDir()（隔离测试用，避免污染 ~/.agent-shell/automations）。 */
  automationsDir?: string
  /** 内置自动任务目录（§16.3）；提供则启动时把内置任务定义重拷进 automationsDir（仿 builtinSkillsDir）。 */
  builtinAutomationsDir?: string
  /** codex create_automation stdio MCP server bundle 绝对路径（§10）；提供则 codex app-server spawn 注入 -c mcp_servers.automation.*。 */
  automationMcpEntry?: string
  /** 测试注入：分类树存储文件路径（automation-categories.json，Plan D D6）；缺省用 paths.ts 真实路径。 */
  automationCategoriesPath?: string
  /** 提供则把该目录作为 renderer 静态产物 serve（prod 同源）；缺省不 serve（dev/测试）。 */
  webDir?: string
  /** 提供则启用宽门 token gate：所有 /api/* 请求须带 AUTH_HEADER=该值，否则 503。缺省不 gate（dev/测试）。 */
  authSecret?: string
  /** 测试注入：transcript 文件目录；缺省用 sessionsDir()。 */
  transcriptDir?: string
  /** 测试注入：技能源清单文件 / git 缓存目录；缺省用 paths.ts 真实路径（隔离测试用，避免污染 ~/.agent-shell）。 */
  skillSourcesPath?: string
  skillSrcCacheDir?: string
  /** 注入 ProviderStore（测试用，隔离到临时文件）；缺省用 channelDataDir 下的 providers.json。 */
  providers?: ProviderStore
  /** 注入命名密钥库 / 实体需求清单文件路径（测试用，隔离到临时文件）；缺省用 paths.ts 真实路径。 */
  secretsPath?: string
  /** 注入凭证来源状态文件路径（auth.json，测试用隔离）；缺省用 paths.ts 真实路径。 */
  authStatePath?: string
  /** 注入代理池文件路径（proxies.json，测试用隔离）；缺省用 paths.ts 真实路径。 */
  proxiesPath?: string
  /** 注入本机 claude 登录检测（测试用，避免碰真实 keychain）；缺省用真实 detectClaudeLogin。 */
  claudeLogin?: () => ClaudeLoginState
  /** 注入本机 codex 登录检测（测试用，避免碰真实 ~/.codex）；缺省用真实 detectCodexLogin。 */
  codexLogin?: () => CodexLoginState
  /** 注入 codex app 内登录引导（测试用，避免 spawn 真 app-server）；缺省用真实 runCodexLogin（绑 bundled codex bin/pathDir）。 */
  codexLoginStart?: (params: CodexLoginParams, onAuthUrl?: (authUrl: string) => void) => Promise<CodexLoginResult>
  /** 注入 OAuth 换 token 的 fetch（测试用，避免真实网络/账号）；缺省走全局 fetch。 */
  oauthFetch?: typeof fetch
  entityRequirementsPath?: string
  /** 注入调度器（测试用）；缺省自建并 armAll。 */
  scheduler?: AutomationScheduler
  /** 自动化 run 结束回调（桌面壳订阅 → 系统通知，§7）。 */
  onAutomationRunDone?: (done: AutomationRunDone) => void
  /** 内置技能目录（§9 builtin 源）；提供则在 createApiRouter 后幂等注册 builtin 源。 */
  builtinSkillsDir?: string
  /** 测试注入：用户创建的技能存放目录；缺省用 paths.ts 真实路径（隔离测试用，避免污染 ~/.agent-shell）。 */
  createdSkillsDir?: string
  /** 测试注入：技能分组清单文件路径；缺省从 sourcesFile 同目录派生。 */
  skillGroupsPath?: string
  /** 测试注入：CLI 工具持久化文件路径；缺省用 paths.ts 真实路径（隔离测试用，避免污染 ~/.agent-shell）。 */
  cliToolsPath?: string
  /** 首启播种开关（仅真实入口 entry.ts 传 true；测试不传→不触发联网 clone）。 */
  seedDefaults?: boolean
}

export async function startDaemon(opts: StartDaemonOptions = {}): Promise<DaemonServer> {
  const detect = opts.detect ?? detectEngines
  const app = express()

  app.use(express.json())

  // 标记 + /api 剥离：先记 req.isApi（供 gate 与 404 收口判定），再镜像 dev 代理 rewrite
  app.use((req, _res, next) => {
    req.isApi = req.url === '/api' || req.url.startsWith('/api/')
    if (req.isApi) req.url = req.url.slice(4) || '/'
    next()
  })

  // 静态产物前置 serve（仅 webDir）：UI 文件(/、/assets/*)放在 gate 之前——
  // 浏览器加载文档/脚本无法带 token，必须免 gate；静态只命中真实文件，不会遮蔽 API 裸路由名。
  if (opts.webDir) app.use(express.static(opts.webDir))

  // 宽门 token gate（仅 authSecret 时）：唯一进 API 的路径 = isApi 且 token 有效。
  // 裸路径（攻击者绕 /api 前缀 / SPA 深链硬刷新）绝不进 API：GET 回 index.html（web-shell，不泄数据），否则 503。
  if (opts.authSecret) {
    const secretBuf = Buffer.from(opts.authSecret, 'utf8')
    const tokenOk = (raw: string): boolean => {
      const got = Buffer.from(raw, 'utf8')
      return got.length === secretBuf.length && timingSafeEqual(got, secretBuf)
    }
    // 取凭证：优先请求头（renderer fetch 注入）；其次 cookie——浏览器发起的 <img>/<iframe> 及其
    // 相对子资源请求带不了自定义头，但同源会自动带 cookie，文件流路由（/api/pf/*）靠它过门。
    const credOf = (req: express.Request): string => {
      const h = req.header(AUTH_HEADER)
      if (h) return h
      const cookie = req.header('cookie')
      if (cookie) {
        for (const part of cookie.split(';')) {
          const eq = part.indexOf('=')
          if (eq === -1) continue
          if (part.slice(0, eq).trim() === AUTH_HEADER) {
            try { return decodeURIComponent(part.slice(eq + 1).trim()) } catch { return part.slice(eq + 1).trim() }
          }
        }
      }
      return ''
    }
    app.use((req, res, next) => {
      if (req.isApi && tokenOk(credOf(req))) return next()
      if (req.isApi) return res.status(503).json(apiErr(AUTH_PENDING_CODE, '桌面授权未就绪'))
      if (opts.webDir && req.method === 'GET') return res.sendFile('index.html', { root: opts.webDir })
      return res.status(503).json(apiErr(AUTH_PENDING_CODE, '桌面授权未就绪'))
    })
  }

  const db = opts.db ?? openDatabase()
  const ownDb = opts.db === undefined   // 自己建的才负责在 close 时关闭
  const secrets = makeSecretStore(opts.secretsPath ?? secretsPath())
  // 凭证来源唯一权威（cli-login / oauth / official-key / providerId）；providers.resolveActiveCreds 据它分支
  const authSources = makeAuthSourceStore(opts.authStatePath ?? authStatePath())
  // app 内 OAuth 令牌库：与 authSources 共写同一个 auth.json（各管各的字段，浅合并互不覆盖）
  const oauthTokens = makeOAuthTokenStore(opts.authStatePath ?? authStatePath())
  // 代理池：来源绑定存于 auth.json（authSources），代理明文存于 proxies.json；resolveActiveProxyUrl 据激活来源解析注入用 URL
  const proxies = makeProxyStore(opts.proxiesPath ?? proxiesPath())
  const providers = opts.providers ?? makeProviderStore(path.join(channelDataDir(), 'providers.json'), secrets, authSources, oauthTokens)
  const entityReqs = makeEntityRequirementStore(opts.entityRequirementsPath ?? entityRequirementsPath())
  const store = makeConfigStore(configPath(), { projectsDir: defaultProjectsDir(), skillsDir: defaultSkillsDir(), automationsDir: defaultAutomationsDir(), debugMode: false })
  // opts 覆盖（测试注入）：提供则该字段恒用 opts 值，不落 config 文件
  const readConfig = () => {
    const c = store.read()
    return {
      projectsDir: opts.projectsDir ?? c.projectsDir,
      skillsDir: opts.skillsDir ?? c.skillsDir,
      automationsDir: opts.automationsDir ?? c.automationsDir,
      debugMode: c.debugMode,
      engineModels: c.engineModels,
    }
  }
  const writeConfig = (p: Parameters<typeof store.write>[0]) => { store.write(p); return readConfig() }
  // codex 自带版（Part A P6）：binPath/pathDir 都来自随包的 @openai/codex 平台二进制（D3，无系统版兜底），
  // 解析一次缓存。claude 仍走 detect()（系统装）。
  let codexBin: ReturnType<typeof resolveCodexBinary> | undefined
  const bundledCodex = (): ReturnType<typeof resolveCodexBinary> => (codexBin ??= resolveCodexBinary())
  const resolveBin = (engine: 'claude' | 'codex'): string => {
    if (engine === 'codex') return bundledCodex().binPath
    const found = detect()[engine]
    if (!found) throw new Error(`未检测到 ${engine} CLI`)
    return found
  }
  const resolveCodexPathDir = (): string | undefined => {
    try { return bundledCodex().pathDir } catch { return undefined }
  }
  // codex app 内登录引导默认实现（绑 bundled codex bin/pathDir）：路由消费，测试可经 opts.codexLoginStart 注入假实现免 spawn。
  const codexLoginStart = opts.codexLoginStart ?? ((params: CodexLoginParams, onAuthUrl?: (u: string) => void) =>
    runCodexLogin({ params, binPath: resolveBin('codex'), pathDir: resolveCodexPathDir(), onAuthUrl }))
  // skill service：stateless（文件系统），双实例（此处 + routes）一致，可共用构造参数。
  const skillSvc = makeSkillService(
    () => readConfig().skillsDir,
    opts.skillSourcesPath ?? skillSourcesPath(),
    opts.skillSrcCacheDir ?? skillSrcCacheDir(),
    undefined,       // home 用缺省
    entityReqs,      // 持久化 needsConfig 用
    undefined,       // createdDir 用缺省
    opts.skillGroupsPath, // 分组清单文件（测试注入；undefined → 从 sourcesFile 同目录派生）
  )
  // 文件态自动化仓库：定义存磁盘 AUTOMATION.md，运行态存 db。automationsDir 走可配置 AppConfig
  // （opts 覆盖优先，落到 readConfig；config 缺省 = defaultAutomationsDir()，见 makeConfigStore defaults）。
  // 上移到 SessionRuntime 之前：create_automation 工具回调要引用它（Claude in-process MCP）。
  const resolveAutomationsDir = () => readConfig().automationsDir
  const automationStore = makeAutomationStore({ db, automationsDir: resolveAutomationsDir })
  // cli-tools service：注入 runtime 供 turn 起处算已装工具上下文 + 挂 as_cli_* MCP（与 routes 同 JSON 文件、双实例一致）
  const cliSvc = makeCliToolService(opts.cliToolsPath)
  const runtime = opts.runtime ?? new SessionRuntime({
    db,
    resolveBin,
    resolveCodexPathDir,
    resolveCreds: (engine) => providers.resolveActiveCreds(engine),
    resolveProxy: (engine) => resolveActiveProxy(engine, authSources, proxies),
    resolveSkillEnv: (projectPath) => resolveSkillEnv(entityReqs, secrets, listInjectedSkills(projectPath).map((n) => 'skill:' + n)).env,
    materializeSkillFiles: (projectPath) =>
      materializeSkillFiles(
        listInjectedSkills(projectPath).map((n) => 'skill:' + n),
        entityReqs, secrets, readConfig().skillsDir,
      ),
    installSkill: (req) => skillSvc.installSkill(req),
    createSkill: (req) => skillSvc.createSkill(req),
    createAutomation: (args) => createAutomationToolHandler(args, { store: automationStore }),
    automationMcpEntry: opts.automationMcpEntry,
    cli: cliSvc,
  })
  // 自动化 run 结束事件 hub：run handler 触发 → 同进程广播给 SSE 订阅者（桌面壳 /automations/events 拉取 → 系统通知）
  const runDoneEmitter = new EventEmitter()
  runDoneEmitter.setMaxListeners(0)
  // 内置自动任务（§16.3）：启动把内置任务定义重拷进库（随 app 更新；运行态在 DB 不动）。
  // 必须在 armAll 之前——否则 armAll 扫不到内置任务文件夹。失败记 error 不崩 daemon。
  if (opts.builtinAutomationsDir) {
    try { materializeBuiltinAutomations(opts.builtinAutomationsDir, resolveAutomationsDir()) }
    catch (e) { console.error('[builtin-automation] materialize 失败', e) }
  }
  // 定时自动化调度器：注入则用注入的（测试），否则自建 + 装 run handler + 排所有启用项的定时器
  const scheduler = opts.scheduler ?? new AutomationScheduler({ db, store: automationStore })
  if (!opts.scheduler) {
    scheduler.setRunHandler(makeAutomationRunHandler({
      db, runtime, store: automationStore,
      resolveProjectsDir: () => readConfig().projectsDir,
      resolveSkillsDir: () => readConfig().skillsDir,
      resolveAutomationsDir,
      onRunDone: (d) => { runDoneEmitter.emit('done', d); opts.onAutomationRunDone?.(d) },
    }))
    scheduler.armAll()
  }
  const onRunDone = (fn: (d: AutomationRunDone) => void): (() => void) => {
    runDoneEmitter.on('done', fn)
    return () => { runDoneEmitter.off('done', fn) }
  }
  app.use('/', createApiRouter({ db, runtime, readConfig, writeConfig, detect, transcriptDir: opts.transcriptDir, skillSourcesPath: opts.skillSourcesPath, skillSrcCacheDir: opts.skillSrcCacheDir, providers, authSources, oauthTokens, oauthFetch: opts.oauthFetch, claudeLogin: opts.claudeLogin ?? detectClaudeLogin, codexLogin: opts.codexLogin ?? detectCodexLogin, codexLoginStart, secrets, entityReqs, scheduler, store: automationStore, automationCategoriesPath: opts.automationCategoriesPath, onRunDone, proxies, builtinSkillsDir: opts.builtinSkillsDir, createdSkillsDir: opts.createdSkillsDir, skillGroupsPath: opts.skillGroupsPath, cliToolsPath: opts.cliToolsPath }))

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' })
  })

  app.get('/engines', (_req, res) => {
    // TODO(后续里程碑): detection 结果可按会话缓存——当前每次请求都全量扫 PATH/fs
    const engines = detect()
    const allMissing = Object.values(engines).every((v) => v === null)
    if (allMissing) {
      const body: ApiError = {
        error: { code: 'cli_not_found', message: '未检测到任何受支持的 CLI（claude / codex）' },
      }
      res.status(503).json(body)
      return
    }
    res.json({ engines })
  })

  // /api 404 收口：走到这里仍未被任何 API 路由/health/engines 命中的 /api/* → 返回 404 JSON（不落 SPA 回退）
  app.use((req, res, next) => {
    if (req.isApi) return res.status(404).json(apiErr('not_found', '接口不存在'))
    next()
  })

  // SPA 回退（仅 webDir；非 /api 才到这里——静态已前置，这里只兜 SPA 导航）
  if (opts.webDir) {
    const webDir = opts.webDir
    app.get(/.*/, (req, res, next) => {
      if (req.method !== 'GET') return next()
      res.sendFile('index.html', { root: webDir })
    })
  }

  const errorHandler: express.ErrorRequestHandler = (_err, _req, res, _next) => {
    const body: ApiError = { error: { code: 'internal', message: '内部错误' } }
    res.status(500).json(body)
  }
  app.use(errorHandler)

  const server = http.createServer(app)
  await new Promise<void>((resolve, reject) => {
    const onListenError = (err: NodeJS.ErrnoException) => {
      reject(err.code === 'EADDRINUSE'
        ? new Error(`daemon 端口已被占用：${opts.port ?? 0}`)
        : err)
    }
    server.once('error', onListenError)
    server.listen(opts.port ?? 0, '127.0.0.1', () => {
      server.off('error', onListenError)
      server.on('error', (err) => { console.error('[daemon] http 错误:', err) })
      resolve()
    })
  })
  const addr = server.address() as AddressInfo
  const url = `http://127.0.0.1:${addr.port}`
  // 首启默认播种（§11）：起监听后后台跑（addSource 的 git clone 同步阻塞，不能挡启动）；仅 entry.ts 传 seedDefaults。
  if (opts.seedDefaults) {
    void seedDefaults({ skills: skillSvc, secrets, entityReqs, config: store }).catch((e) => console.error('[seed] 播种失败', e))
  }
  return {
    url,
    port: addr.port,
    close: () =>
      new Promise<void>((resolve) => {
        scheduler.stop()   // 停所有自动化定时器
        server.close(() => { if (ownDb) db.close(); resolve() })
        server.closeIdleConnections()
        // 活跃的 SSE 长连接（持有未结束的 res）不是 idle，closeIdleConnections 关不掉——
        // 必须 closeAllConnections 强制断，否则优雅关闭会一直等到客户端自己断开（生产 daemon 重启会挂起）。
        server.closeAllConnections()
      }),
  }
}
