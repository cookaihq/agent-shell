/**
 * agents/codex/subagent.tsx — codex 并发子代理整条链（codex 切片私有，spec §4.2/§6）。
 *
 * 三挂载槽（外壳只提供槽位、不读切片私有态）：
 *   - 形态 A（timelineMount）：主时间线里 spawnAgent 锚点块 → 内联 .codex-pool 并发组（cxp-group），
 *     每个并发子代理一个可折叠 cxp-agent 行（task + 状态点 + mini-timeline + 汇报），加 cxp-wait「主代理等待中」徽章。
 *   - 形态 C（headerEntry）：cxp-entry ⬢ 头像堆叠入口（每并发子代理一个 ⬢），点击切右栏 board。
 *   - 形态 B（rightViews）：cxp-board，每个并发子代理一列（task 标签 + 完整 mini-timeline + 汇报 + 状态）。
 *
 * 与 claude 切片（taskId 单流、parentToolUseId 归属）不同：codex 是 threadId 索引的多 thread 模型，
 * 子线程内容来自 CodexSubagentEvent(phase:'item')，本切片把它们映射成中立 Block 喂共享 renderTimeline。
 */
import './subagent.css'
import type { ReactNode } from 'react'
import type { Block } from '../../../api/types'
import type { CodexSubItem } from '@agent-shell/contracts'
import type { SaCtx, SliceViewCtx, ViewSlot } from '../types'
import { renderTimeline } from '../../timeline'
import {
  initCodexSubagentState,
  codexSubagentReduce,
  subsByParent,
  allSubs,
  isWaiting,
  anyWaiting,
  taskLabel,
  CXP_STAT,
  type CodexSubagentState,
  type CodexSub,
} from './subagentView'

// 再导出 reducer/init 给 registry 直接挂载（与 claude 切片对称）。
export { initCodexSubagentState, codexSubagentReduce }

/** 从不透明 sliceState 取出 codex 切片态。 */
const stateOf = (sliceState: unknown): CodexSubagentState =>
  (sliceState as CodexSubagentState | undefined) ?? initCodexSubagentState()

/**
 * 子线程 mini-timeline：CodexSubItem[] → 中立 Block[]（同构子集），喂共享 renderTimeline。
 * message→text / thinking→thinking / tool_use→tool_use / tool_result→tool_result（中立工具种类 tool 透传）。
 */
function itemsToBlocks(items: CodexSubItem[]): Block[] {
  const blocks: Block[] = []
  for (const it of items) {
    if (it.kind === 'message') blocks.push({ type: 'text', text: it.text })
    else if (it.kind === 'thinking') blocks.push({ type: 'thinking', text: it.text })
    else if (it.kind === 'tool_use') blocks.push({ type: 'tool_use', id: it.id, name: it.name, input: it.input, ...(it.tool ? { tool: it.tool } : {}) })
    else if (it.kind === 'tool_result') blocks.push({ type: 'tool_result', toolUseId: it.toolUseId, ok: it.ok, content: it.content })
  }
  return blocks
}

/** 渲染一个子代理的 mini-timeline（共享 renderTimeline；子线程无嵌套 Task → mountTask 不需要）。 */
function SubTimeline({ sub, ctx }: { sub: CodexSub; ctx: SaCtx }) {
  const blocks = itemsToBlocks(sub.items)
  const subCtx: SaCtx = { ...ctx, sliceState: undefined, mountTask: undefined }
  return <div className="chat-timeline">{renderTimeline(blocks, subCtx)}</div>
}

/** 子代理汇报块（cxp-report）：完成时给主代理的最终汇报。 */
function Report({ report }: { report: string }) {
  return (
    <div className="cxp-report">
      <span className="cxp-report-ic">↩</span>
      <span className="cxp-report-text">{report}</span>
    </div>
  )
}

// ── 形态 A：时间线内联并发组（cxp-group / .codex-pool）─────────────────────────────

/** 形态 A 单个并发子代理行（cxp-agent，可折叠；完成态默认展开，对齐原型「子代理 A open」）。 */
function CxpAgentRow({ sub, ctx }: { sub: CodexSub; ctx: SaCtx }) {
  const stat = CXP_STAT[sub.status]
  const defaultOpen = sub.status === 'completed'
  return (
    <details className="cxp-agent" {...(defaultOpen ? { open: true } : {})}>
      <summary>
        <span className={`cxp-stat ${stat.cls}`} />
        <span className="cxp-task" title={sub.task}>{taskLabel(sub.task)}</span>
        <span className="cxp-chev">▸</span>
      </summary>
      <div className="cxp-inner">
        <SubTimeline sub={sub} ctx={ctx} />
        {sub.report && <Report report={sub.report} />}
      </div>
    </details>
  )
}

/**
 * 左·时间线挂载（spec §6 形态 A 接缝）：外壳对每个 tool_use 块委托此函数。
 *   - 非 spawnAgent 锚点块 → 返回 undefined（外壳正常渲染该块，不被切片接管）。
 *   - spawnAgent 锚点块但该父 thread 下无子代理 → 返回 null（节点消失，避免空组）。
 *   - 命中 → 渲染 .codex-pool 并发组。
 */
export function timelineMount(block: Extract<Block, { type: 'tool_use' }>, ctx: SaCtx): ReactNode {
  if (block.name !== 'spawnAgent') return undefined
  const state = stateOf(ctx.sliceState)
  const parentThreadId = (block.input as { parentThreadId?: string })?.parentThreadId
  const subs = parentThreadId ? subsByParent(state, parentThreadId) : []
  if (subs.length === 0) return null
  const runCount = subs.filter((s) => CXP_STAT[s.status].running).length
  const waiting = parentThreadId ? isWaiting(state, parentThreadId) : false
  return (
    <div className="tl-item">
      <span className="tl-dot agent" />
      <div className="tl-body">
        <div className="codex-pool">
          <div className="cxp-head">
            <span className="cxp-icon">⬡</span>
            <span className="cxp-title">并行子代理 · {subs.length} 个 · {runCount} 运行中</span>
            {waiting && <span className="cxp-wait"><span className="cxp-wait-dot" />⏳ 主代理等待中</span>}
          </div>
          <div className="cxp-list">
            <div className="cxp-rail" />
            {subs.map((sub) => <CxpAgentRow key={sub.threadId} sub={sub} ctx={ctx} />)}
          </div>
        </div>
      </div>
    </div>
  )
}

// ── 形态 C：header 头像入口（cxp-entry）──────────────────────────────────────────

/** 上·header 挂载（spec §6 形态 C）：⬢ 头像堆叠（每并发子代理一个）；无子代理整块不渲染。 */
export function headerEntry(ctx: SliceViewCtx): ReactNode {
  const state = stateOf(ctx.sliceState)
  const subs = allSubs(state)
  if (subs.length === 0) return null
  return (
    <button className="sa-entry cxp-entry" title="查看 Codex 并发子代理（在右侧实时展示）" onClick={() => ctx.onShowAgents?.()}>
      <span className="sa-stack">
        {subs.map((s) => <span key={s.threadId} className="sa-ava cxp-ava">⬢</span>)}
      </span>
    </button>
  )
}

// ── 形态 B：右栏并发流看板（cxp-board）────────────────────────────────────────────

/** 单列（一个并发子代理的完整实时流）。 */
function CxpCol({ sub }: { sub: CodexSub }) {
  const stat = CXP_STAT[sub.status]
  const blocks = itemsToBlocks(sub.items)
  const colCtx: SaCtx = { resultMap: buildSubResultMap(blocks), childrenOf: new Map(), sliceState: undefined }
  return (
    <div className={`cxp-col${stat.running ? ' is-run' : ''}`}>
      <div className="cxp-col-head">
        <span className={`cxp-stat ${stat.cls}`} />
        <span className="cxp-task" title={sub.task}>{taskLabel(sub.task)}</span>
        <span className={`cxp-col-badge ${stat.cls}`}>{stat.label}</span>
      </div>
      {sub.task && <div className="cxp-col-task-label">任务：{taskLabel(sub.task)}</div>}
      <div className="cxp-col-body">
        <div className="chat-timeline">{renderTimeline(blocks, colCtx)}</div>
        {sub.report && <Report report={sub.report} />}
      </div>
    </div>
  )
}

/** 子线程 tool_result 配对（mini-timeline 用；不依赖外壳全局 blocks）。 */
function buildSubResultMap(blocks: Block[]): SaCtx['resultMap'] {
  const map: SaCtx['resultMap'] = new Map()
  for (const b of blocks) if (b.type === 'tool_result') map.set(b.toolUseId, { ok: b.ok, content: b.content })
  return map
}

/** 形态 B 并发流看板面板。 */
function CxpBoard({ ctx }: { ctx: SliceViewCtx }) {
  const state = stateOf(ctx.sliceState)
  const subs = allSubs(state)
  const runCount = subs.filter((s) => CXP_STAT[s.status].running).length
  const doneCount = subs.filter((s) => s.status === 'completed').length
  const waiting = anyWaiting(state)
  return (
    <div className="cxp-panel">
      <div className="cxp-pbar">
        <span className="cxp-icon">⬢</span>
        <span><b>{subs.length} 个并行子代理</b> · {runCount} 运行中 · {doneCount} 已完成</span>
        {waiting && <span className="cxp-wait" style={{ marginLeft: 'auto' }}><span className="cxp-wait-dot" />⏳ 主代理等待中</span>}
      </div>
      <div className="cxp-board">
        {subs.map((sub) => <CxpCol key={sub.threadId} sub={sub} />)}
      </div>
    </div>
  )
}

/** 右·面板挂载（spec §6 形态 B）：返回 codex 并发看板视图槽（有子代理才显示）。 */
export function rightViews(ctx: SliceViewCtx): ViewSlot[] {
  const subs = allSubs(stateOf(ctx.sliceState))
  return [{
    id: 'codex-agents',
    tabLabel: <>子代理 <span className="cnt">{subs.length}</span></>,
    hasContent: subs.length > 0,
    render: () => <CxpBoard ctx={ctx} />,
  }]
}
