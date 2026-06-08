/**
 * agents/codex/subagentView.ts — codex 并发子代理展示的切片辅助（形态 A 组 / 形态 B 看板 / 形态 C 入口三处复用）。
 *
 * 与 claude subagentView 的本质区别（spec §4.2/§4.3）：
 *   - claude：taskId 主键、单流；靠 parentToolUseId 把内容归到子代理；状态四态。
 *   - codex：**threadId 主键、多 thread 并发**；子线程内容全封进 CodexSubagentEvent(phase:'item') 按 threadId 归属；
 *     状态六态（CodexSubStatus）；父子组织靠 parentThreadId（一个父 thread = 一个 cxp-group / board）。
 *
 * 本文件含：纯函数 reducer（codexSubagentReduce）+ threadId 索引态（CodexSubagentState）+
 * 取组/等待标志/状态徽章等展示辅助。reduce 不渲染、不依赖 React。
 */
import type { AgentEvent, CodexSubItem, CodexSubStatus } from '@agent-shell/contracts'

/** 单个 codex 子代理（一条独立 thread）的累计态。 */
export interface CodexSub {
  /** 子线程 threadId（主键）。 */
  threadId: string
  /** 父（发起）thread = senderThreadId；同一 parentThreadId 的子代理归一个并发组。 */
  parentThreadId?: string
  /** 子代理任务（spawnAgent.prompt 全文；无角色名，靠它标识身份）。 */
  task?: string
  /** 状态机（CodexSubStatus 六态）；spawned 默认 pendingInit。 */
  status: CodexSubStatus
  /** 子线程 mini-timeline 块序列（按到达顺序；流式 message 替换当前流式块）。 */
  items: CodexSubItem[]
  /** 子代理给父的最终汇报（wait 完成时 agentsStates[tid].message）。 */
  report?: string
  /** closeAgent 已关闭标记（展示用；不覆盖已有终态）。 */
  closed?: boolean
}

/**
 * codex 切片私有累计态：
 *   - subs：threadId → 子代理（多 thread 并发）。
 *   - waiting：父(主) threadId → 是否正 wait 阻塞（驱动 cxp-wait「主代理等待中」徽章）。
 */
export interface CodexSubagentState {
  subs: Record<string, CodexSub>
  waiting: Record<string, boolean>
}

/** 切片私有 sliceState 初值。 */
export function initCodexSubagentState(): CodexSubagentState {
  return { subs: {}, waiting: {} }
}

/** 取/建某 threadId 的子代理条目（不可变拷贝，供 reduce 内更新）。 */
function ensureSub(prev: CodexSub | undefined, threadId: string): CodexSub {
  return prev ?? { threadId, status: 'pendingInit', items: [] }
}

/**
 * 子线程 item 追加/替换：
 *   - message{streaming:true}：替换「当前末尾的流式 message」（reducer 替换语义，对齐 MessageEvent）；
 *     若末尾不是流式 message → 新增一条流式 message。
 *   - message{streaming 缺省}（定格）：若末尾是流式 message → 原地落定为该定格块；否则追加。
 *   - 其余 kind（thinking/tool_use/tool_result）：一律追加。
 */
function appendItem(items: CodexSubItem[], item: CodexSubItem): CodexSubItem[] {
  const last = items[items.length - 1]
  const lastIsStreamingMsg = last && last.kind === 'message' && last.streaming === true
  if (item.kind === 'message') {
    if (lastIsStreamingMsg) {
      // 流式累计帧 或 定格帧 都替换当前流式块（定格帧落定 streaming 标志）。
      const next = items.slice(0, -1)
      next.push(item)
      return next
    }
    return [...items, item]
  }
  return [...items, item]
}

/** 终态：不应被 closed 或后续低优状态覆盖。 */
const TERMINAL: ReadonlySet<CodexSubStatus> = new Set<CodexSubStatus>(['completed', 'interrupted', 'errored', 'shutdown'])

/**
 * codex 子代理生命周期纯函数 reducer（spec §5.4/§6）：外壳把非外壳解释的 codex_subagent 事件委托到此。
 * 非 codex_subagent 事件原样返回（外壳已先处理共享事件）。永远返回新引用（不改旧 state）。
 */
export function codexSubagentReduce(state: CodexSubagentState, ev: AgentEvent): CodexSubagentState {
  if (ev.type !== 'codex_subagent') return state
  const tid = ev.threadId

  if (ev.phase === 'wait') {
    // wait 归属主 thread（threadId=主）：置/清等待标志。
    return { ...state, waiting: { ...state.waiting, [tid]: !!ev.waiting } }
  }

  const prev = state.subs[tid]
  const base = ensureSub(prev, tid)
  let sub: CodexSub = base

  if (ev.phase === 'spawned') {
    sub = { ...base, ...(ev.parentThreadId ? { parentThreadId: ev.parentThreadId } : {}), ...(ev.task !== undefined ? { task: ev.task } : {}) }
  } else if (ev.phase === 'item') {
    if (ev.item) sub = { ...base, items: appendItem(base.items, ev.item) }
  } else if (ev.phase === 'status') {
    if (ev.status) sub = { ...base, status: ev.status }
  } else if (ev.phase === 'report') {
    if (ev.report !== undefined) sub = { ...base, report: ev.report }
  } else if (ev.phase === 'closed') {
    // 标记关闭；状态仅在「非终态」时兜底为 shutdown（已完成/中止等终态保留真实终态）。
    sub = { ...base, closed: true, ...(TERMINAL.has(base.status) ? {} : { status: 'shutdown' }) }
  }

  if (sub === base && prev !== undefined) return state   // 无变化（如 item 缺 item 字段）→ 原引用
  return { ...state, subs: { ...state.subs, [tid]: sub } }
}

// ── 展示辅助 ──────────────────────────────────────────────────────────────────

/** 取某父 thread 下的全部并发子代理（按 spawned 顺序，即插入顺序）。 */
export function subsByParent(state: CodexSubagentState, parentThreadId: string): CodexSub[] {
  return Object.values(state.subs).filter((s) => s.parentThreadId === parentThreadId)
}

/** 全部子代理（无父过滤；形态 C 头像堆叠用）。 */
export function allSubs(state: CodexSubagentState): CodexSub[] {
  return Object.values(state.subs)
}

/** 主代理是否正 wait 阻塞（驱动 cxp-wait 徽章）。 */
export function isWaiting(state: CodexSubagentState, mainThreadId: string): boolean {
  return !!state.waiting[mainThreadId]
}

/** 任意一个父 thread 正 wait（形态 C/B header 无明确主 thread 时的聚合判断）。 */
export function anyWaiting(state: CodexSubagentState): boolean {
  return Object.values(state.waiting).some(Boolean)
}

/**
 * CodexSubStatus 六态 → 展示：
 *   - cls：原型 .cxp-stat 圆点类（run 蓝脉冲 / done 绿 / pending 灰）。
 *   - label：形态 B col-head 的中文徽章文案。
 *   - running：是否「进行中」（驱动 .is-run 高亮 / 头部计数）。
 */
export const CXP_STAT: Record<CodexSubStatus, { cls: string; label: string; running: boolean }> = {
  pendingInit: { cls: 'pending', label: '待启动', running: false },
  running: { cls: 'run', label: '运行中', running: true },
  completed: { cls: 'done', label: '已完成', running: false },
  interrupted: { cls: 'pending', label: '已中断', running: false },
  errored: { cls: 'pending', label: '出错', running: false },
  shutdown: { cls: 'pending', label: '已关闭', running: false },
}

/** 子代理任务首行（去掉「角色：」等多行 prompt 的换行，取首句作 cxp-task 简标）。 */
export function taskLabel(task: string | undefined): string {
  if (!task) return '子代理'
  const firstLine = task.split('\n')[0].trim()
  return firstLine || '子代理'
}
