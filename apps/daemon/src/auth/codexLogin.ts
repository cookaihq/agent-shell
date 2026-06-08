import { spawn as nodeSpawn } from 'node:child_process'
import { CodexJsonRpcClient } from '../runtimes/codex/jsonRpc'
import { CodexProtocolAdapter0137 } from '../runtimes/codex/protocolAdapter'
import { sanitizeEnv } from '../runtimes/env'
import { codexDef } from '../runtimes/defs/codex'

/**
 * Codex【app 内登录引导】（Part A · Phase 7.4）。
 *
 * codex 的「授权登录」由 **app-server 自管**（不像 claude 自实现粘码 OAuth）：
 *   - apiKey：`account/login/start{type:'apiKey',apiKey}` → response `{type:'apiKey'}` 即同步成功（写本机 ~/.codex/auth.json）。
 *   - chatgpt：`account/login/start{type:'chatgpt'}` → response `{type:'chatgpt', loginId, authUrl}`；
 *     调用方据 authUrl 引导浏览器授权；完成态经 **`account/login/completed{loginId,success,error}`** 通知回来 → resolve/reject。
 *
 * 形态权威：codex 0.137 baseline v2/LoginAccountParams · LoginAccountResponse · AccountLoginCompletedNotification（probe-notes §6）。
 *
 * ⚠️ 登录写的是**本机 ~/.codex**（不覆盖 CODEX_HOME）——与「官网 API Key」(official-key 源·env 注入·不碰 ~/.codex)语义不同：
 *    本通路改本机全局 codex 登录态，调用方 UI 须明示。
 *
 * 一次性瞬时进程：起 app-server → initialize → account/login/start → （chatgpt 等 completed / apiKey 立即）→ 关进程。
 */

export type CodexLoginParams =
  | { type: 'apiKey'; apiKey: string }
  | { type: 'chatgpt'; codexStreamlinedLogin?: boolean }

export interface CodexLoginResult { ok: true }

/** client 抽象（CodexJsonRpcClient 满足）：login 只用 request/close，便于注入假实现。 */
export interface CodexLoginClientLike {
  request<T = unknown>(method: string, params?: unknown): Promise<T>
  close(graceMs?: number): void
}
export interface CodexLoginClientFactoryOpts {
  binPath: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  spawnFn?: typeof nodeSpawn
  onNotification: (method: string, params: unknown) => void
  onServerRequest: (method: string, id: number, params: unknown) => void
  onExit?: (code: number | null, err?: Error) => void
}

export interface RunCodexLoginOpts {
  params: CodexLoginParams
  binPath: string
  /** 自带版 codex 的 codex-path 目录（含 rg）：prepend 到 spawn PATH。省略=不补。 */
  pathDir?: string
  baseEnv?: NodeJS.ProcessEnv
  /** chatgpt 流程拿到 authUrl 时回调（调用方据此引导浏览器）。apiKey 流程不触发。 */
  onAuthUrl?: (authUrl: string) => void
  /** 注入假 client 工厂（测试）；省略=真 CodexJsonRpcClient（spawn 真 app-server）。 */
  clientFactory?: (opts: CodexLoginClientFactoryOpts) => CodexLoginClientLike
  spawnFn?: typeof nodeSpawn
  /** 兜底超时（ms）：chatgpt 久不完成则 reject 并关进程。省略=5 分钟。 */
  timeoutMs?: number
}

interface LoginStartResponse {
  type: 'apiKey' | 'chatgpt' | 'chatgptDeviceCode'
  loginId?: string
  authUrl?: string
}
interface LoginCompletedNotification { loginId: string | null; success: boolean; error: string | null }

/**
 * 跑一次 codex 登录引导。resolve {ok:true} = 登录成功；reject = 失败（含取消/超时/进程崩）。
 * apiKey 同步成功；chatgpt 异步等 account/login/completed 匹配本次 loginId 的通知。
 */
export function runCodexLogin(opts: RunCodexLoginOpts): Promise<CodexLoginResult> {
  const adapter = new CodexProtocolAdapter0137()
  // 登录走本机 ~/.codex：不注入 creds（sanitizeEnv 仅剥继承凭证、不写 base_url/key），不设 CODEX_HOME。
  const env = sanitizeEnv(codexDef.authStrategy, opts.baseEnv ?? process.env)
  if (opts.pathDir) {
    const sep = process.platform === 'win32' ? ';' : ':'
    env.PATH = [opts.pathDir, ...(env.PATH ? env.PATH.split(sep).filter(Boolean) : [])].join(sep)
  }

  return new Promise<CodexLoginResult>((resolve, reject) => {
    let settled = false
    let myLoginId: string | undefined
    let timer: ReturnType<typeof setTimeout> | undefined
    const done = (err?: Error): void => {
      if (settled) return
      settled = true
      if (timer) clearTimeout(timer)
      try { client.close() } catch { /* 已关 */ }
      if (err) reject(err); else resolve({ ok: true })
    }

    const onNotification = (method: string, params: unknown): void => {
      if (method !== 'account/login/completed') return
      const p = params as LoginCompletedNotification | null | undefined
      // 仅认本次 loginId 的完成通知（chatgpt）；apiKey 流程已在 start 时同步结掉、不会走到这。
      if (!p || (myLoginId !== undefined && p.loginId !== myLoginId)) return
      if (p.success) done()
      else done(new Error(p.error || 'codex 授权登录失败'))
    }
    const onExit = (code: number | null, err?: Error): void => {
      done(err ?? (settled ? undefined : new Error(`codex app-server 登录进程退出${code !== null ? ` (exit ${code})` : ''}`)))
    }

    const factory = opts.clientFactory ?? ((o: CodexLoginClientFactoryOpts) => new CodexJsonRpcClient(o) as CodexLoginClientLike)
    const client = factory({
      binPath: opts.binPath,
      args: ['app-server'],
      cwd: process.cwd(),
      env,
      spawnFn: opts.spawnFn,
      onNotification,
      onServerRequest: () => { /* 登录流程不预期 server→client 请求；忽略 */ },
      onExit,
    })

    timer = setTimeout(() => done(new Error('codex 登录超时')), opts.timeoutMs ?? 300_000)

    void (async () => {
      try {
        await client.request('initialize', adapter.buildInitializeParams())
        const r = await client.request<LoginStartResponse>('account/login/start', opts.params)
        if (r?.type === 'apiKey') {
          done()   // apiKey 同步成功
          return
        }
        // chatgpt / chatgptDeviceCode：记 loginId，回吐 authUrl，等 completed 通知
        myLoginId = r?.loginId
        if (r?.authUrl) opts.onAuthUrl?.(r.authUrl)
        // 无 authUrl 也无 apiKey 成功 → 异常形态
        if (!r?.authUrl && !r?.loginId) done(new Error('account/login/start 返回形态异常（无 authUrl/loginId）'))
      } catch (e) {
        done(e instanceof Error ? e : new Error(String(e)))
      }
    })()
  })
}
