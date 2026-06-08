import type { AgentEvent } from '@agent-shell/contracts'
import { spawn as nodeSpawn } from 'node:child_process'
import { CodexJsonRpcClient } from './jsonRpc'
import { CodexProtocolAdapter0137, type CodexProtocolAdapter } from './protocolAdapter'
import { sanitizeEnv } from '../env'
import { codexDef } from '../defs/codex'
import type { ProviderCreds, CodexProviderInject } from '../types'

/**
 * 把一个自定义 Provider 注入意图编成 codex app-server 的 `-c` 启动覆盖参数（probe-notes §6 实测形态）。
 * 纯函数（便于单测固定形态）：
 *   `-c model_provider=<name>`
 *   `-c model_providers.<name>.name="<name>"`
 *   `-c model_providers.<name>.base_url="<baseUrl>"`   ← 字符串值带引号（probe §6）
 *   `-c model_providers.<name>.wire_api=<chat|responses>`
 *   `-c model_providers.<name>.env_key=OPENAI_API_KEY`  ← key 经 env 注入（codex 据 env_key 读环境变量）
 * 与 claude 的纯 env 注入不同：codex 的 Provider 注入更富（需 provider 名 + 协议），故走 `-c`。
 * 进程级覆盖、不写用户 config.toml、不动 CODEX_HOME（probe §6 推荐方式）。
 */
export function buildCodexProviderArgs(inject: CodexProviderInject): string[] {
  // config key 段（model_providers.<key>）须是 TOML 裸键安全字符：把非 [A-Za-z0-9_-] 折成下划线，
  // 空/纯符号名兜底 'provider'。展示名仍用原始 providerName 写进 .name="..."（带引号，可含任意字符）。
  const key = (inject.providerName.replace(/[^A-Za-z0-9_-]/g, '_') || 'provider')
  const escName = inject.providerName.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  return [
    '-c', `model_provider=${key}`,
    '-c', `model_providers.${key}.name="${escName}"`,
    '-c', `model_providers.${key}.base_url="${inject.baseUrl}"`,
    '-c', `model_providers.${key}.wire_api=${inject.wireApi}`,
    '-c', `model_providers.${key}.env_key=${codexDef.authStrategy.apiKeyEnv}`,
  ]
}

/**
 * 把 create_automation 的独立 stdio MCP server 编成 codex app-server 的 `-c mcp_servers.automation.*` 启动覆盖。
 * 纯函数（便于单测固定形态）。codex spawn `node <entry>`（env AGENT_SHELL_MCP_ENTRY=1 触发 bundle 入口跑 stdio）。
 * value 按 TOML 解析：字符串带引号、args 是数组、env 是内联表（`=` 不是 `:`、键不加引号）。进程级覆盖、不写 config.toml。
 */
export function buildCodexAutomationMcpArgs(entry: string): string[] {
  return [
    '-c', `mcp_servers.automation.command="node"`,
    '-c', `mcp_servers.automation.args=["${entry}"]`,
    '-c', `mcp_servers.automation.env={ AGENT_SHELL_MCP_ENTRY = "1" }`,
  ]
}

/**
 * Codex app-server【turn 驱动】（Part A · Phase 3.3）。
 *
 * 把「常驻 app-server 进程 + jsonRpc 传输 + 协议适配」包成一个与 ClaudeSdkHandle **同形**的句柄，
 * 供 SessionRuntime（3.4）按引擎多态地续投/中断/收尾。codex app-server 是**常驻保活**的（一个进程跑多 turn），
 * 语义对齐 claude 的持久 query：
 *   - 一轮结束（turn/completed）→ 触发 onTurnEnd，但**进程/client 不退**，等下一次 pushUser；
 *   - `done` 只在 **client/进程真正退出**（endInput 优雅关 / interrupt / 崩溃）时 resolve——与 ClaudeSdkHandle.done 同契约。
 *
 * 生命周期（probe-notes §1）：
 *   initialize → thread/start（或 resumableId 时 thread/resume）→ 取 threadId（fire onResumableId 一次）
 *   → turn/start。notification 回路里：turn/started 记 turnId；agentMessage delta 累计流式；其余走 adapter.mapEvent。
 *
 * 流式与定格的对账（避免重复正文）：
 *   - `item/agentMessage/delta`（delta 是**增量片段**，非累计）→ 本层按 itemId 累计，emit message{streaming:true, text:累计全文}。
 *   - 该 item 的 `item/completed`（含 item.text 全文）→ 交给 adapter.mapEvent（eventMap）emit 定格 message（streaming 缺省）。
 *     本层在 completed 时清掉该 itemId 累计态，不自己再 emit，避免与 eventMap 的定格重复。
 *     reducer 语义：streaming 帧替换当前流式块，定格帧追加/落定（contracts events.ts MessageEvent 注释）。
 */

/** 用户对一次授权/提问的裁决（与 ClaudeSdkDecision 同形，供 SessionRuntime 统一回执）。Phase 4 才真正消费。 */
export interface CodexDecision {
  behavior: 'allow' | 'deny'
  message?: string
  updatedInput?: Record<string, unknown>
}

/** runCodexAppServerTurn 入参：ClaudeSdkTurnOpts 的 codex 子集（去掉 claude 专属：images/checkpoint/installSkill/热切 setter/outputFormat 等）。 */
export interface CodexAppServerTurnOpts {
  cwd: string
  model: string
  prompt: string
  /** 沙箱档（read-only/workspace-write/danger-full-access）→ thread/start.sandbox（identity）。 */
  sandbox?: string
  /** 审批档（untrusted/on-request/never）→ thread/start.approvalPolicy（identity）。 */
  approval?: string
  /** 思考强度（ReasoningEffort）→ turn/start.effort（identity）。 */
  effort?: string
  /** 需授权读取的项目外目录（保留入参；codex 沙箱授权 Phase 7 细化，本层暂不消费）。 */
  addDirs?: string[]
  /** 引擎侧 resume 指针（codex thread_id）：有则 thread/resume 续接，无则 thread/start 新建。 */
  resumableId?: string
  baseEnv?: NodeJS.ProcessEnv
  /** Provider 直连（V1 不传）。 */
  creds?: ProviderCreds
  /** 本次 run 激活技能解析出的 env（技能密钥）；省略=不注入。 */
  skillEnv?: Record<string, string>
  /** 自带版 codex 绝对路径（spawn 用）。 */
  binPath: string
  /** 自带版 codex 的 codex-path 目录（含 ripgrep `rg`）：prepend 到 spawn PATH，codex 文件搜索依赖。省略=不补。 */
  pathDir?: string
  /** spawn 参数；默认 ['app-server']。BYOK/Provider `-c` 覆盖在此叠加（Phase 7）。 */
  args?: string[]
  /** create_automation stdio MCP server bundle 的绝对路径；有则注入 -c mcp_servers.automation.*（§10）。 */
  automationMcpEntry?: string
  onEvent: (ev: AgentEvent) => void
  /** 每个 turn_end（含合成的终结）触发一次；上层据此续投/收尾。 */
  onTurnEnd?: (stopReason: string) => void
  /** 嗅到 resume 指针（codex threadId）时回调，整个 client 生命周期至多一次。 */
  onResumableId?: (id: string) => void
  /** idle 看门狗：turn 进行中距上次通知超此毫秒数无动静 → 合成 failed turn_end + 中断。0/省略=不启用。 */
  idleTimeoutMs?: number
  /** 注入协议适配器（测试 / 未来多版本）；省略=0.137。 */
  adapter?: CodexProtocolAdapter
  /** 注入 client 工厂（测试用假 client，免 spawn 真 codex）；省略=真 CodexJsonRpcClient。 */
  clientFactory?: (opts: CodexClientFactoryOpts) => CodexClientLike
  /** 注入假 spawnFn（不用 clientFactory 时透传给真 client）；省略=node:child_process.spawn。 */
  spawnFn?: typeof nodeSpawn
}

/** clientFactory 收到的构造参数（= CodexJsonRpcClient 构造 opts 的子集 + 已净化 env）。 */
export interface CodexClientFactoryOpts {
  binPath: string
  args: string[]
  cwd: string
  env: NodeJS.ProcessEnv
  spawnFn?: typeof nodeSpawn
  onNotification: (method: string, params: unknown) => void
  onServerRequest: (method: string, id: number, params: unknown) => void
  onExit?: (code: number | null, err?: Error) => void
}

/** client 抽象（CodexJsonRpcClient 满足它）：driver 只依赖这几个方法，便于注入假实现。 */
export interface CodexClientLike {
  request<T = unknown>(method: string, params?: unknown): Promise<T>
  respond(id: number, result: unknown): void
  close(graceMs?: number): void
}

/** codex turn 句柄：= RuntimeTurnHandle（done/interrupt/pushUser/endInput）+ resolveDecision（与 ClaudeSdkHandle 对称子集）。 */
export interface CodexAppServerHandle {
  /** 与 RuntimeTurnHandle 同形（exitCode 对 app-server 恒 null）：client/进程退出后 resolve。 */
  done: Promise<{ exitCode: number | null }>
  /** 中断当前 turn：发 turn/interrupt {threadId, turnId}（必带 turnId，见 probe §1）。 */
  interrupt: (graceMs?: number) => void
  /** 同一 thread 续投下一条 user 消息（常驻 server 上新起一个 turn/start，重置 turn 态）。 */
  pushUser: (text: string) => void
  /** 结束输入：app-server 常驻无 stdin-EOF 语义 → endInput = 优雅关闭 client（当前 turn 跑完后）。 */
  endInput: () => void
  /** 解决一个挂起的 server→client 审批请求（renderer 回执）：
   *  查 pending 表拿 jsonRpcId，把 decision.behavior 映射成 codex 决策枚举
   *  （allow→accept；deny→decline 或 cancel，按该 request 的 availableDecisions），回 app-server `{decision}`。
   *  amendment/acceptForSession 等枚举 V1 不暴露。未知/过期 requestId 静默忽略。 */
  resolveDecision: (requestId: string, decision: CodexDecision) => void
}

/** 起一轮（或 resume 续接）codex app-server 会话：包常驻进程，对外暴露与 ClaudeSdkHandle 同形的 handle。 */
export function runCodexAppServerTurn(opts: CodexAppServerTurnOpts): CodexAppServerHandle {
  const adapter = opts.adapter ?? new CodexProtocolAdapter0137()
  const env = sanitizeEnv(codexDef.authStrategy, opts.baseEnv ?? process.env, opts.creds, opts.skillEnv)
  // 自带版 codex 的 codex-path（含 ripgrep `rg`）prepend 到 PATH——镜像官方 shim：codex 文件搜索/工具
  // 依赖随包的 rg，自带版不再走系统 PATH 上的 codex（也就拿不到 shim 自动补的 PATH），须本层补上。
  if (opts.pathDir) {
    const sep = process.platform === 'win32' ? ';' : ':'
    env.PATH = [opts.pathDir, ...(env.PATH ? env.PATH.split(sep).filter(Boolean) : [])].join(sep)
  }

  // ── 终结契约：done 在 client 退出时 resolve；onExit 兜底合成 failed turn_end（防 UI 卡「运行中」）──
  let resolveDone!: (v: { exitCode: number | null }) => void
  const done = new Promise<{ exitCode: number | null }>((res) => { resolveDone = res })

  // turn 进行态 + 终结守卫：turnActive 控制 idle 看门狗；sawTurnEnd 防止 onExit 与正常 turn/completed 双发终结。
  let threadId: string | undefined
  let currentTurnId: string | undefined
  let turnActive = false
  let sawTurnEnd = false        // 本 turn 是否已产出 turn_end（正常或合成）
  let resumableFired = false
  let aborted = false           // interrupt() 置位：合成终结时区分 aborted/failed
  let closing = false           // endInput/正常收尾置位：onExit 不再当失败处理

  // 流式累计：itemId → 累计全文（agentMessage delta 是增量片段，本层拼成累计全文喂 streaming message）。
  const streamAcc = new Map<string, string>()

  // ── 子代理多 thread 路由态（Phase 5a）────────────────────────────────────────
  // threadId → 角色档案。main = boot 时 thread/start 拿到的 thread；sub = 被 spawnAgent.receiverThreadId 揭示的子线程。
  // 归属键永远是 threadId（probe §5）。主线 notification（params.threadId===主 thread / 缺省）仍走 mapAppServerEvent 不变。
  interface ThreadProfile { role: 'main' | 'sub'; parentThreadId?: string; task?: string }
  const threads = new Map<string, ThreadProfile>()
  // 子线程 agentMessage 流式累计：key=`${tid} ${itemId}`（与主线 streamAcc 隔离，避免 itemId 撞）。
  const subStreamAcc = new Map<string, string>()
  // agentsStates[tid].status 上次已发值：仅在变化时 emit phase:'status'，避免重复。
  const lastSubStatus = new Map<string, string>()
  // 形态A 锚点去重：已为哪些父(发起)thread emit 过主线 spawnAgent tool_use 锚点块。
  // 一个父 thread 即便分多次 spawnAgent 派生多个子代理，也只产一个锚点块（renderer 在该块下铺所有并发子代理，对齐原型一个 cxp-group）。
  const anchoredParents = new Set<string>()

  // 任何「非空、非主 thread」的 threadId 都按子线程路由——即便 spawn 通知漏抓、该 tid 还没入档：
  // 这样它的 turn/completed 等也绝不会漏进主 mapEvent 误产主 turn_end（回归护栏的关键）。
  // boot 完成前 threadId 尚 undefined：此时一律当主线（不会有子线程先于主 thread/start 出现）。
  const isSubThread = (tid: string | undefined): boolean =>
    typeof tid === 'string' && tid !== '' && threadId !== undefined && tid !== threadId

  // 挂起的 server→client 审批请求 requestId(=itemId) → jsonRpcId。resolveDecision 据此回执。
  const pendingApprovals = new Map<string, number>()
  // 同一 requestId 的 availableDecisions（per-request 决策枚举集）。deny 时据此在 decline/cancel 间择优。
  const pendingDecisions = new Map<string, unknown[]>()

  // idle 看门狗：turn 进行中超时无通知 → 判卡死，合成 failed + 中断（镜像 claudeSdk）。
  let idleTimer: ReturnType<typeof setTimeout> | undefined
  const clearIdle = (): void => { if (idleTimer) { clearTimeout(idleTimer); idleTimer = undefined } }
  const resetIdle = (): void => {
    if (!opts.idleTimeoutMs || !turnActive) { clearIdle(); return }
    clearIdle()
    idleTimer = setTimeout(() => {
      aborted = true
      emitTurnEnd('failed', `idle 超时：${Math.round((opts.idleTimeoutMs ?? 0) / 1000)}s 无响应`)
      try { client.close() } catch { /* 关闭失败不致命，onExit 会兜底 resolve done */ }
    }, opts.idleTimeoutMs)
  }

  // 统一 turn_end 出口：emit turn_end 事件 + 触发 onTurnEnd；置 turnActive=false 停看门狗。守卫保证一 turn 只一次。
  const emitTurnEnd = (stopReason: string, detail?: string): void => {
    if (sawTurnEnd) return
    sawTurnEnd = true
    turnActive = false
    clearIdle()
    opts.onEvent({ type: 'turn_end', stopReason, ...(detail ? { detail } : {}) })
    opts.onTurnEnd?.(stopReason)
  }

  // ── 子代理编排：collabAgentToolCall item → CodexSubagentEvent（spawned/wait/report/closed/status）。
  // 这些 item 跑在主 thread（senderThreadId=主），但归属/语义由 item 内容决定，不进主时间线 mapEvent。
  const handleCollabItem = (method: string, item: Record<string, any>): void => {
    const tool = item.tool                                   // 'spawnAgent' | 'wait' | 'closeAgent'
    const sender = typeof item.senderThreadId === 'string' ? item.senderThreadId : undefined
    const receivers: string[] = Array.isArray(item.receiverThreadIds) ? item.receiverThreadIds.filter((x: unknown) => typeof x === 'string') : []
    const states = (item.agentsStates && typeof item.agentsStates === 'object') ? item.agentsStates as Record<string, { status?: string; message?: string | null }> : {}
    const completed = method === 'item/completed'

    if (tool === 'spawnAgent') {
      // spawn 的 receiverThreadIds/prompt 只在 item/completed 才齐（started 时为空）→ 在 completed 揭示子线程并 emit spawned。
      if (completed) {
        const task = typeof item.prompt === 'string' ? item.prompt : undefined
        // 形态A 锚点：派生发生在主 thread 的一次主线工具调用 → 同时 emit 一个**主线共享 tool_use** 块（name='spawnAgent'），
        // 给主时间线一个可挂载点；renderer codex 切片的 timelineMount 命中它，在该块下铺 parentThreadId===sender 的全部并发子代理。
        // 不带顶层 threadId（主线事件无 thread 标签，回归护栏要求）；父 thread 维度去重，一父一锚点（一个 cxp-group）。
        if (sender && !anchoredParents.has(sender)) {
          anchoredParents.add(sender)
          opts.onEvent({ type: 'tool_use', id: `spawnAgent:${sender}`, name: 'spawnAgent', input: { parentThreadId: sender } })
        }
        for (const sub of receivers) {
          threads.set(sub, { role: 'sub', parentThreadId: sender, task })
          opts.onEvent({ type: 'codex_subagent', phase: 'spawned', threadId: sub, ...(sender ? { parentThreadId: sender } : {}), ...(task !== undefined ? { task } : {}) })
        }
      }
    } else if (tool === 'wait') {
      // wait 是主代理「等待编排」态：started→waiting:true / completed→waiting:false（驱动 cxp-wait 徽章），归属主 thread。
      if (sender) opts.onEvent({ type: 'codex_subagent', phase: 'wait', threadId: sender, parentThreadId: sender, waiting: !completed })
      // completed 携带各子的 agentsStates[tid].message = 子代理汇报 → 每个完成的子 emit report。
      if (completed) {
        for (const [tid, st] of Object.entries(states)) {
          if (typeof st?.message === 'string' && st.message) {
            opts.onEvent({ type: 'codex_subagent', phase: 'report', threadId: tid, report: st.message })
          }
        }
      }
    } else if (tool === 'closeAgent') {
      if (completed) {
        for (const sub of receivers) opts.onEvent({ type: 'codex_subagent', phase: 'closed', threadId: sub })
      }
    }
    // 任何 collab item 携带的 agentsStates 状态变更 → emit phase:'status'（去重：仅与上次不同时发）。
    emitSubStatus(states)
  }

  // agentsStates 状态机变更 → phase:'status'（pendingInit→running→completed/...）。去重，避免每条 collab item 重发同态。
  const emitSubStatus = (states: Record<string, { status?: string }>): void => {
    for (const [tid, st] of Object.entries(states)) {
      const status = st?.status
      if (typeof status !== 'string' || !status) continue
      if (lastSubStatus.get(tid) === status) continue
      lastSubStatus.set(tid, status)
      opts.onEvent({ type: 'codex_subagent', phase: 'status', threadId: tid, status: status as any })
    }
  }

  // ── 子线程 item 路由：子线程内容封进 CodexSubagentEvent(phase:'item')，不进主时间线、不产主 turn_end。
  const handleSubNotification = (method: string, tid: string, p: Record<string, any>): void => {
    // 子线程 agentMessage 流式增量：按 `${tid} ${itemId}` 累计 → phase:'item'{kind:'message',streaming:true,累计全文}。
    if (method === 'item/agentMessage/delta') {
      const itemId = typeof p.itemId === 'string' ? p.itemId : ''
      const delta = typeof p.delta === 'string' ? p.delta : ''
      if (itemId && delta) {
        const key = `${tid} ${itemId}`
        const cumulative = (subStreamAcc.get(key) ?? '') + delta
        subStreamAcc.set(key, cumulative)
        opts.onEvent({ type: 'codex_subagent', phase: 'item', threadId: tid, item: { kind: 'message', text: cumulative, streaming: true } })
      }
      return
    }
    if (method === 'item/started' || method === 'item/completed') {
      const item = p.item as Record<string, any> | undefined
      if (item?.type === 'agentMessage' && method === 'item/completed' && typeof item.id === 'string') {
        subStreamAcc.delete(`${tid} ${item.id}`)   // 清流式态，定格块由下方 mapSubItem 给出
      }
      const sub = adapter.mapSubItem(item, method === 'item/started')
      if (sub) opts.onEvent({ type: 'codex_subagent', phase: 'item', threadId: tid, item: sub })
      return
    }
    // 子线程 turn/started · turn/completed · turn/diff/updated · thread/* 等 → 忽略（绝不产主 turn_end，防回归）。
  }

  const onNotification = (method: string, params: unknown): void => {
    resetIdle()   // 任何通知 → 重置看门狗
    const p = params as Record<string, unknown> | null | undefined

    // ① collabAgentToolCall（主代理编排子代理）：先于主/子路由拦截 → CodexSubagentEvent，不进 mapEvent。
    if (method === 'item/started' || method === 'item/completed') {
      const it = (p?.item ?? undefined) as Record<string, any> | undefined
      if (it?.type === 'collabAgentToolCall') { handleCollabItem(method, it); return }
    }

    // ② 子线程 notification（params.threadId 是已知子 thread）→ 走子路由，不污染主时间线、不产主 turn_end。
    const tid = typeof p?.threadId === 'string' ? p.threadId : undefined
    if (isSubThread(tid)) { handleSubNotification(method, tid as string, (p ?? {}) as Record<string, any>); return }

    // ③ 主线 notification（主 thread / 缺省 threadId）：以下逻辑保持与改造前**逐字节一致**（回归敏感）。
    // turn/started：记当前 turnId（interrupt 必需；缺它 -32600）。turnId 在 turn.id，NOT params.turnId。
    if (method === 'turn/started') {
      try { currentTurnId = adapter.extractTurnId(params) } catch { /* 容错：缺 turn.id 不崩 */ }
      return
    }

    // agentMessage 流式增量：本层按 itemId 累计成全文，emit streaming message（定格交给 item/completed → eventMap）。
    if (method === 'item/agentMessage/delta') {
      const itemId = typeof p?.itemId === 'string' ? p.itemId : ''
      const delta = typeof p?.delta === 'string' ? p.delta : ''
      if (itemId && delta) {
        const cumulative = (streamAcc.get(itemId) ?? '') + delta
        streamAcc.set(itemId, cumulative)
        opts.onEvent({ type: 'message', text: cumulative, streaming: true })
      }
      return
    }

    // 某 agentMessage item 完成：清其流式累计态（定格 message 由下方 mapEvent → eventMap emit，本层不重复 emit）。
    if (method === 'item/completed') {
      const item = p?.item as { type?: unknown; id?: unknown } | undefined
      if (item?.type === 'agentMessage' && typeof item.id === 'string') streamAcc.delete(item.id)
    }

    // turn/completed 经 mapEvent 产出 turn_end → 走 emitTurnEnd（保活：client 不退，等 pushUser）。
    const mapped = adapter.mapEvent(method, params)
    for (const ev of mapped) {
      if (ev.type === 'turn_end') {
        emitTurnEnd(ev.stopReason, (ev as { detail?: string }).detail)
      } else {
        opts.onEvent(ev)
      }
    }
  }

  // server→client 请求（审批）：记 requestId(=itemId)→jsonRpcId + 本次 availableDecisions，并 emit permission_request。
  // requestId 与 emit 出去的一致 → renderer POST 回 resolveDecision 时能对账回执对应的 jsonRpcId。
  // 仅处理两类审批 method（command / fileChange）；其余 server request 不 emit（仍登记 pending 以便日后回执，不致丢失）。
  const onServerRequest = (method: string, id: number, params: unknown): void => {
    const p = (params ?? {}) as Record<string, unknown>
    const itemId = p.itemId
    const requestId = typeof itemId === 'string' && itemId ? itemId : String(id)
    pendingApprovals.set(requestId, id)
    const available = Array.isArray(p.availableDecisions) ? p.availableDecisions : []
    pendingDecisions.set(requestId, available)

    const reason = typeof p.reason === 'string' ? p.reason : undefined

    if (method === 'item/commandExecution/requestApproval') {
      // 命令审批：归一为 shell 工具（对齐 eventMap 的 commandExecution → name:'shell'）；input 给 {command, cwd}。
      opts.onEvent({
        type: 'permission_request',
        requestId,
        toolName: 'shell',
        input: { command: p.command, cwd: p.cwd },
        ...(reason ? { description: reason } : {}),
      })
    } else if (method === 'item/fileChange/requestApproval') {
      // 文件改动审批（apply_patch）：fixture 未抓到，按 FileChangeRequestApprovalParams 防御取最小字段。
      opts.onEvent({
        type: 'permission_request',
        requestId,
        toolName: 'apply_patch',
        input: { grantRoot: p.grantRoot },
        ...(reason ? { description: reason } : {}),
      })
    }
    // 非审批 server request：仅登记 pending，不 emit permission_request。
  }

  // client 退出/spawn 失败：无 turn_end 见过 → 合成（aborted 用户中止 / failed 异常）；resolve done（永不挂起）。
  const onExit = (code: number | null, err?: Error): void => {
    clearIdle()
    if (!sawTurnEnd && turnActive) {
      const stopReason = aborted ? 'aborted' : 'failed'
      const detail = stopReason === 'failed'
        ? (err?.message ?? (code !== null && code !== 0 ? `exit ${code}` : undefined))
        : undefined
      emitTurnEnd(stopReason, detail)
    }
    resolveDone({ exitCode: null })
  }

  // spawn 子命令：默认 app-server；自定义 Provider（creds.codex 在场）追加 `-c` 启动覆盖（probe §6）。
  // claude 走纯 env，无此分支；codex official-key/oauth 形态无 codex 扩展也不拼 -c（仍 key→env）。
  const baseArgs = opts.args ?? ['app-server']
  // create_automation：codex 经独立 stdio MCP server 接入（codex 首个 MCP，§10）。-c 启动覆盖叠加，与 Provider 注入并行。
  const mcpArgs = opts.automationMcpEntry ? buildCodexAutomationMcpArgs(opts.automationMcpEntry) : []
  const providerArgs = opts.creds?.codex ? buildCodexProviderArgs(opts.creds.codex) : []
  const spawnArgs = [...baseArgs, ...mcpArgs, ...providerArgs]

  const factory = opts.clientFactory ?? ((o: CodexClientFactoryOpts) => new CodexJsonRpcClient(o))
  const client: CodexClientLike = factory({
    binPath: opts.binPath,
    args: spawnArgs,
    cwd: opts.cwd,
    env,
    spawnFn: opts.spawnFn,
    onNotification,
    onServerRequest,
    onExit,
  })

  // ── 生命周期编排：initialize → thread/start|resume → turn/start ──
  const startTurnParams = (tid: string, text: string) =>
    adapter.buildTurnStartParams(tid, text, { effort: opts.effort })

  const boot = async (): Promise<void> => {
    await client.request('initialize', adapter.buildInitializeParams())
    let tid: string
    if (opts.resumableId) {
      const r = await client.request('thread/resume', adapter.buildThreadResumeParams(opts.resumableId))
      tid = adapter.extractThreadId(r)
    } else {
      const r = await client.request('thread/start', adapter.buildThreadStartParams({
        cwd: opts.cwd,
        model: opts.model,
        approval: opts.approval,
        sandbox: opts.sandbox,
      }))
      tid = adapter.extractThreadId(r)
    }
    threadId = tid
    threads.set(tid, { role: 'main' })   // 主 thread 入档：后续 notification 据此区分主/子路由
    if (!resumableFired) { resumableFired = true; opts.onResumableId?.(tid) }   // threadId = resume 指针
    turnActive = true
    sawTurnEnd = false
    resetIdle()
    await client.request('turn/start', startTurnParams(tid, opts.prompt))
  }

  // boot 失败（initialize/thread/start reject，常见进程崩/坏 binPath）→ 合成 failed + resolve done。
  void boot().catch((err: unknown) => {
    if (closing) return   // endInput 主动关导致的 reject 不算失败
    emitTurnEnd('failed', err instanceof Error ? err.message : String(err))
    resolveDone({ exitCode: null })
  })

  return {
    done,
    interrupt: (graceMs?: number) => {
      aborted = true
      // 必带 turnId（缺它 -32600）：仅在已知 threadId + turnId 时发 interrupt，否则直接关。
      if (threadId && currentTurnId) {
        void client.request('turn/interrupt', adapter.buildInterruptParams(threadId, currentTurnId)).catch(() => {})
      }
      // interrupt 后 turn/completed.status=interrupted 会到来 → emitTurnEnd('interrupted')；这里不抢先合成，
      // 但用户主动中止：直接关闭 client，onExit 兜底确保 done resolve（若 completed 没及时到）。
      try { client.close(graceMs) } catch { /* 已关 */ }
    },
    pushUser: (text: string) => {
      // 同 thread 新起一个 turn：重置 turn 态（turnId 由新 turn/started 重填）。
      currentTurnId = undefined
      turnActive = true
      sawTurnEnd = false
      streamAcc.clear()
      resetIdle()
      if (threadId) void client.request('turn/start', startTurnParams(threadId, text)).catch(() => {})
    },
    endInput: () => {
      // app-server 无 stdin-EOF：endInput = 优雅关闭 client（当前 turn 跑完后进程退出 → onExit → done resolve）。
      closing = true
      clearIdle()
      try { client.close() } catch { /* 已关 */ }
    },
    resolveDecision: (requestId: string, decision: CodexDecision) => {
      const jsonRpcId = pendingApprovals.get(requestId)
      if (jsonRpcId === undefined) return   // 未知/过期 requestId 静默忽略
      const available = pendingDecisions.get(requestId) ?? []
      pendingApprovals.delete(requestId)
      pendingDecisions.delete(requestId)
      // CodexDecision.behavior → codex 决策枚举（CommandExecution/FileChangeApprovalDecision）。
      // V1 仅 accept / decline|cancel：amendment（acceptWithExecpolicyAmendment 等）/ acceptForSession 暂不暴露。
      // deny：优先 'decline'（fileChange 提供），无则 'cancel'（command fixture 只给 cancel）。
      const codexDecision = decision.behavior === 'allow'
        ? 'accept'
        : (available.includes('decline') ? 'decline' : 'cancel')
      client.respond(jsonRpcId, { decision: codexDecision })
    },
  }
}
