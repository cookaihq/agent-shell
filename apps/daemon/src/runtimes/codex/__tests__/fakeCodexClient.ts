import type { CodexClientFactoryOpts, CodexClientLike } from '../codexAppServer'

/**
 * 共享测试夹具：假 codex app-server client（实现 CodexClientLike）。
 *
 * 每次 runCodexAppServerTurn 起一个实例（多实例 → 支持「续投起新 server」的断言）。测试用 current() 拿最近实例，
 * 喂 notification（turn/started、item/...、thread/tokenUsage/updated、turn/completed 等）、触发 server request / exit，
 * 并断言发出的 request 序列（initialize → thread/start|resume → turn/start ...）。
 *
 * request 按 method 返回假 response（thread/start→thread.id；turn/start→turn.id），驱动 driver 的 boot 链跑完。
 * close() → onExit(null)（→ done resolve），与真 client「关闭即退出」语义一致。
 *
 * 与 codexAppServer.test.ts 内联的 makeFakeClient 同形，提炼为共享模块供 sessionRuntime / lifecycle e2e / routes SSE 复用。
 */
export interface FakeCodexInstance {
  cbs: CodexClientFactoryOpts
  client: CodexClientLike
  requests: Array<{ method: string; params: unknown; id: number }>
  responds: Array<{ id: number; result: unknown }>
  closes: number[]
  responder: Map<string, unknown>
  notify: (method: string, params: unknown) => void
  serverRequest: (method: string, id: number, params: unknown) => void
  exit: (code: number | null, err?: Error) => void
}

export interface FakeCodexHarness {
  factory: (o: CodexClientFactoryOpts) => CodexClientLike
  instances: FakeCodexInstance[]
  current: () => FakeCodexInstance
}

export function fakeCodexClient(): FakeCodexHarness {
  const instances: FakeCodexInstance[] = []
  const factory = (o: CodexClientFactoryOpts): CodexClientLike => {
    let reqId = 0
    const responder = new Map<string, unknown>([
      ['initialize', { userAgent: 'agent-shell-probe/0.137.0 (Mac OS) unknown' }],
      ['thread/start', { thread: { id: 'th-1' } }],
      ['thread/resume', { thread: { id: 'th-resumed' } }],
      ['turn/start', { turn: { id: 'turn-1' } }],
      ['turn/interrupt', {}],
    ])
    const inst: FakeCodexInstance = {
      cbs: o,
      requests: [], responds: [], closes: [], responder,
      client: null as unknown as CodexClientLike,
      notify: (method, params) => o.onNotification(method, params),
      serverRequest: (method, id, params) => o.onServerRequest(method, id, params),
      exit: (code, err) => o.onExit?.(code, err),
    }
    const client: CodexClientLike = {
      request: <T>(method: string, params?: unknown): Promise<T> => {
        const id = ++reqId
        inst.requests.push({ method, params, id })
        const r = responder.has(method) ? responder.get(method) : {}
        return Promise.resolve(r as T)
      },
      respond: (id: number, result: unknown) => { inst.responds.push({ id, result }) },
      close: (graceMs?: number) => { inst.closes.push(graceMs ?? -1); o.onExit?.(null) },   // close → onExit（done resolve）
    }
    inst.client = client
    instances.push(inst)
    return client
  }
  return { factory, instances, current: () => instances[instances.length - 1] }
}
