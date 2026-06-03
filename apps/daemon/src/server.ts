import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { timingSafeEqual } from 'node:crypto'
import express from 'express'
import type Database from 'better-sqlite3'
import type { ApiError } from '@agent-shell/contracts'
import { AUTH_HEADER, AUTH_PENDING_CODE } from '@agent-shell/contracts'
import { detectEngines } from './runtimes/detection'
import { openDatabase } from './db/database'
import { SessionRuntime } from './session/sessionRuntime'
import { createApiRouter } from './api/routes'
import { defaultProjectsDir, defaultSkillsDir, configPath } from './paths'
import { makeConfigStore } from './config/store'

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
  /** 提供则把该目录作为 renderer 静态产物 serve（prod 同源）；缺省不 serve（dev/测试）。 */
  webDir?: string
  /** 提供则启用宽门 token gate：所有 /api/* 请求须带 AUTH_HEADER=该值，否则 503。缺省不 gate（dev/测试）。 */
  authSecret?: string
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
    app.use((req, res, next) => {
      if (req.isApi && tokenOk(req.header(AUTH_HEADER) ?? '')) return next()
      if (req.isApi) return res.status(503).json(apiErr(AUTH_PENDING_CODE, '桌面授权未就绪'))
      if (opts.webDir && req.method === 'GET') return res.sendFile('index.html', { root: opts.webDir })
      return res.status(503).json(apiErr(AUTH_PENDING_CODE, '桌面授权未就绪'))
    })
  }

  const db = opts.db ?? openDatabase()
  const ownDb = opts.db === undefined   // 自己建的才负责在 close 时关闭
  const store = makeConfigStore(configPath(), { projectsDir: defaultProjectsDir(), skillsDir: defaultSkillsDir() })
  // opts 覆盖（测试注入）：提供则该字段恒用 opts 值，不落 config 文件
  const readConfig = () => {
    const c = store.read()
    return {
      projectsDir: opts.projectsDir ?? c.projectsDir,
      skillsDir: opts.skillsDir ?? c.skillsDir,
    }
  }
  const writeConfig = (p: Parameters<typeof store.write>[0]) => { store.write(p); return readConfig() }
  const resolveBin = (engine: 'claude' | 'codex'): string => {
    const found = detect()[engine]
    if (!found) throw new Error(`未检测到 ${engine} CLI`)
    return found
  }
  const runtime = opts.runtime ?? new SessionRuntime({ db, resolveBin })
  app.use('/', createApiRouter({ db, runtime, readConfig, writeConfig, detect }))

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
  return {
    url,
    port: addr.port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => { if (ownDb) db.close(); resolve() })
        server.closeIdleConnections()
        // 活跃的 SSE 长连接（持有未结束的 res）不是 idle，closeIdleConnections 关不掉——
        // 必须 closeAllConnections 强制断，否则优雅关闭会一直等到客户端自己断开（生产 daemon 重启会挂起）。
        server.closeAllConnections()
      }),
  }
}
