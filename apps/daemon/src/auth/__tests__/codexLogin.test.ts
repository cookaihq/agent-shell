import { describe, it, expect, vi } from 'vitest'
import { runCodexLogin, type CodexLoginClientFactoryOpts, type CodexLoginClientLike, type RunCodexLoginOpts } from '../codexLogin'

/**
 * 假 codex app-server login client：实现 CodexLoginClientLike，把构造回调暴露给测试，
 * 可脚本化喂 account/login/start 的 response + account/login/completed 通知 + exit。
 * 形态权威：baseline v2/LoginAccountParams|LoginAccountResponse|AccountLoginCompletedNotification。
 */
function fakeLoginClient(responder: Record<string, unknown> = {}) {
  let cbs!: CodexLoginClientFactoryOpts
  const requests: Array<{ method: string; params: unknown }> = []
  let closed = 0
  const client: CodexLoginClientLike = {
    request: (method: string, params?: unknown) => {
      requests.push({ method, params })
      return Promise.resolve((method in responder ? responder[method] : {}) as never)
    },
    close: () => { closed++ },
  }
  const factory = (o: CodexLoginClientFactoryOpts) => { cbs = o; return client }
  return {
    factory, requests,
    closes: () => closed,
    notify: (method: string, params: unknown) => cbs.onNotification(method, params),
    exit: (code: number | null, err?: Error) => cbs.onExit?.(code, err),
    getCbs: () => cbs,
  }
}

const baseOpts = (over: Partial<RunCodexLoginOpts> & Pick<RunCodexLoginOpts, 'params'>): RunCodexLoginOpts =>
  ({ binPath: '/abs/codex', baseEnv: { PATH: '/usr/bin' }, ...over })

describe('runCodexLogin · apiKey 直登（同步成功）', () => {
  it('account/login/start{type:apiKey,apiKey} → response type:apiKey 即成功', async () => {
    const h = fakeLoginClient({ 'account/login/start': { type: 'apiKey' } })
    const r = await runCodexLogin(baseOpts({ params: { type: 'apiKey', apiKey: 'sk-x' }, clientFactory: h.factory }))
    expect(r).toEqual({ ok: true })
    expect(h.requests.map((q) => q.method)).toEqual(['initialize', 'account/login/start'])
    expect(h.requests[1].params).toEqual({ type: 'apiKey', apiKey: 'sk-x' })
    expect(h.closes()).toBe(1)   // 成功后关闭瞬时 app-server
  })
})

describe('runCodexLogin · chatgpt OAuth（app-server 自管，返回 authUrl，待完成通知）', () => {
  it('start 返回 {loginId, authUrl} → onAuthUrl 回调拿到 url；completed{success:true} → resolve ok', async () => {
    const h = fakeLoginClient({ 'account/login/start': { type: 'chatgpt', loginId: 'lg-1', authUrl: 'https://auth.openai.com/x' } })
    const onAuthUrl = vi.fn()
    const p = runCodexLogin(baseOpts({ params: { type: 'chatgpt' }, clientFactory: h.factory, onAuthUrl }))
    // 等 boot+start 跑完，authUrl 回调应已触发
    await vi.waitFor(() => expect(onAuthUrl).toHaveBeenCalledWith('https://auth.openai.com/x'))
    // 浏览器侧授权完成 → app-server 发 completed 通知
    h.notify('account/login/completed', { loginId: 'lg-1', success: true, error: null })
    await expect(p).resolves.toEqual({ ok: true })
    expect(h.closes()).toBe(1)
  })

  it('completed{success:false,error} → reject 带 error', async () => {
    const h = fakeLoginClient({ 'account/login/start': { type: 'chatgpt', loginId: 'lg-2', authUrl: 'https://x' } })
    const p = runCodexLogin(baseOpts({ params: { type: 'chatgpt' }, clientFactory: h.factory, onAuthUrl: () => {} }))
    await vi.waitFor(() => expect(h.requests.length).toBe(2))
    h.notify('account/login/completed', { loginId: 'lg-2', success: false, error: '用户取消授权' })
    await expect(p).rejects.toThrow('用户取消授权')
  })

  it('completed 通知的 loginId 与本次 start 不符 → 忽略（不误结）', async () => {
    const h = fakeLoginClient({ 'account/login/start': { type: 'chatgpt', loginId: 'lg-3', authUrl: 'https://x' } })
    const p = runCodexLogin(baseOpts({ params: { type: 'chatgpt' }, clientFactory: h.factory, onAuthUrl: () => {} }))
    await vi.waitFor(() => expect(h.requests.length).toBe(2))
    h.notify('account/login/completed', { loginId: 'other', success: true, error: null })   // 别人的
    h.notify('account/login/completed', { loginId: 'lg-3', success: true, error: null })     // 自己的
    await expect(p).resolves.toEqual({ ok: true })
  })
})

describe('runCodexLogin · 失败/收尾', () => {
  it('app-server 进程提前退出（无 completed）→ reject', async () => {
    const h = fakeLoginClient({ 'account/login/start': { type: 'chatgpt', loginId: 'lg', authUrl: 'https://x' } })
    const p = runCodexLogin(baseOpts({ params: { type: 'chatgpt' }, clientFactory: h.factory, onAuthUrl: () => {} }))
    await vi.waitFor(() => expect(h.requests.length).toBe(2))
    h.exit(1, new Error('app-server 崩了'))
    await expect(p).rejects.toThrow()
  })

  it('不注入 creds → spawn env 不设 CODEX_HOME（登录写本机 ~/.codex）', async () => {
    const h = fakeLoginClient({ 'account/login/start': { type: 'apiKey' } })
    await runCodexLogin(baseOpts({ params: { type: 'apiKey', apiKey: 'k' }, clientFactory: h.factory }))
    expect('CODEX_HOME' in h.getCbs().env).toBe(false)
  })
})
