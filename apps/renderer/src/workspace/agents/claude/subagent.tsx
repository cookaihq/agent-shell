/**
 * agents/claude/subagent.tsx — 子代理整条链（claude 切片私有，spec §6）。
 *
 * Phase 2 平移自外壳：把 subagent 的「私有累计态 + 三形态渲染」整体收进 claude 切片，
 * 外壳只提供三个挂载槽（左·时间线 / 上·header / 右·面板），自身不读 SubagentMeta（依赖倒置）。
 *
 * 本文件含：
 *   - SubagentState（= Record<toolUseId|taskId, SubagentMeta>）+ subagentReduce（原 chatReducer 的 'subagent' case）
 *   - resolveSa / SubagentNode（形态 A）/ DelegateRow（形态 B flat 委托行）
 *   - timelineMount（左·形态 A 接缝，含 skipTranscript §9.5 过滤）
 *   - headerEntry（上·形态 C 头像入口）
 *   - rightViews（右·形态 B Gallery/Board 面板）
 */
import './subagent.css'
import { useState } from 'react'
import type { ReactNode } from 'react'
import type { Block, SubagentMeta, AgentEvent } from '../../../api/types'
import type { SaCtx, SliceViewCtx, ViewSlot } from '../types'
import { renderTimeline, buildResultMap, buildChildrenMap } from '../../timeline'
import { saAvatarClass, saAvatarLetter, SA_STAT, fmtSaMeta, subagentList } from './subagentView'

// ── 私有累计态（spec §5.4 sliceState 槽）──────────────────────────────────────
// 键 = toolUseId（缺省退 taskId）：task_started/progress/notification 累计。会话级累计、不随 turn 清空。
export type SubagentState = Record<string, SubagentMeta>

/** 切片私有 sliceState 初值。 */
export function initSubagentState(): SubagentState {
  return {}
}

/**
 * 子代理生命周期累计（原 chatReducer 'subagent' case 平移）：started/progress → running；ended → status（默认 completed）。
 * R2 根治：SDK 三类消息 tool_use_id 皆 optional → 一律以 taskId 作稳定主键归并；toolUseId 作别名指向同一 meta，不分裂。
 * 外壳把非外壳解释的事件委托到此（spec §5.4）；非 subagent 事件原样返回（外壳已先处理共享事件）。
 */
export function subagentReduce(state: SubagentState, ev: AgentEvent): SubagentState {
  if (ev.type !== 'subagent') return state
  const prevByTask = state[ev.taskId] as SubagentMeta | undefined
  // toolUseId：本次缺省则沿用 started 记下的（progress/ended 常不带）
  const toolUseId = ev.toolUseId ?? prevByTask?.toolUseId
  const prev: Partial<SubagentMeta> = prevByTask ?? {}
  const meta: SubagentMeta = {
    ...prev,
    taskId: ev.taskId,
    ...(toolUseId ? { toolUseId } : {}),
    ...(ev.subagentType ? { subagentType: ev.subagentType } : {}),
    ...(ev.description ? { description: ev.description } : {}),
    ...(ev.usage ? { usage: ev.usage } : {}),
    ...(ev.lastToolName ? { lastToolName: ev.lastToolName } : {}),
    ...(ev.summary ? { summary: ev.summary } : {}),
    ...(ev.skipTranscript !== undefined ? { skipTranscript: ev.skipTranscript } : {}),
    status: ev.phase === 'ended' ? (ev.status ?? 'completed') : (prev.status === 'completed' || prev.status === 'failed' || prev.status === 'stopped' ? prev.status : 'running'),
  }
  // 主键 taskId + 别名 toolUseId 同指一条 meta 引用（右侧聚合按 taskId 去重，避免别名重复渲染）。
  const next: SubagentState = { ...state, [ev.taskId]: meta }
  if (toolUseId) next[toolUseId] = meta
  return next
}

/** 从 ctx 取出切片私有 subagent map（不透明 sliceState → 自家形状）。 */
const subagentsOf = (sliceState: unknown): SubagentState => (sliceState as SubagentState | undefined) ?? {}

/** 子代理类型/描述：优先实时 meta（来自 system 消息）；缺省退 Task input（history 重载时无 meta，靠持久化 Task 块兜底）。 */
function resolveSa(block: Extract<Block, { type: 'tool_use' }>, subagents: SubagentState, resultMap: SaCtx['resultMap']) {
  const meta = subagents[block.id]
  const inp = block.input as { subagent_type?: string; description?: string }
  const type = meta?.subagentType || (typeof inp?.subagent_type === 'string' ? inp.subagent_type : '') || 'subagent'
  const desc = meta?.description ?? (typeof inp?.description === 'string' ? inp.description : '')
  const result = resultMap.get(block.id)
  const status: SubagentMeta['status'] = meta?.status ?? (result ? (result.ok ? 'completed' : 'failed') : 'running')
  return { meta, type, desc, status }
}

/** 子代理头行（形态 A）：agent 点 + 头像 + 类型 + Subagent 标签 + 描述 + 状态 + 用量 + 折叠箭头；
 *  默认折叠，点开见缩进的内部迷你时间线（递归 renderTimeline，支持多层）。 */
function SubagentNode({ block, ctx }: { block: Extract<Block, { type: 'tool_use' }>; ctx: SaCtx }) {
  const subagents = subagentsOf(ctx.sliceState)
  const { meta, type, desc, status } = resolveSa(block, subagents, ctx.resultMap)
  const stat = SA_STAT[status]
  const metaText = fmtSaMeta(meta?.usage)
  const children = ctx.childrenOf.get(block.id) ?? []
  const running = status === 'running'
  return (
    <div className="tl-item">
      <span className={`tl-dot agent${running ? ' run' : ''}`} />
      <div className="tl-body">
        <details className="subagent">
          <summary className="sa-line">
            <span className={`sa-ava ${saAvatarClass(type)}`}>{saAvatarLetter(type)}</span>
            <span className="sa-name">{type}</span>
            <span className="sa-tag">Subagent</span>
            {desc && <span className="sa-desc" title={desc}>{desc}</span>}
            <span className={`sa-stat ${stat.cls}`}>{stat.label}</span>
            {metaText && <span className="sa-meta">{metaText}</span>}
            <span className="sa-chev">▸</span>
          </summary>
          <div className="sa-inner">
            <div className="chat-timeline">{renderTimeline(children, ctx)}</div>
          </div>
        </details>
      </div>
    </div>
  )
}

/** flat 下（形态 B 卡片体内）的「委托 X」行：父代理调 Task 工具的那个 tool_use 即此行，点击跳到对应子代理卡片（D16）。 */
function DelegateRow({ block, ctx }: { block: Extract<Block, { type: 'tool_use' }>; ctx: SaCtx }) {
  const subagents = subagentsOf(ctx.sliceState)
  const { meta, type, status } = resolveSa(block, subagents, ctx.resultMap)
  const taskId = meta?.taskId ?? block.id
  const running = status === 'running'
  return (
    <div className="tl-item">
      <span className={`tl-dot agent${running ? ' run' : ''}`} />
      <div className="tl-body">
        <button className="sa-delegate" onClick={() => ctx.onJump?.(taskId)} title="跳到该子代理卡片">
          <span className={`sa-ava ${saAvatarClass(type)}`}>{saAvatarLetter(type)}</span>
          <span className="sa-name">{type}</span>
          <span className="sa-deleg-label">委托 →</span>
        </button>
      </div>
    </div>
  )
}

/** 左·时间线挂载（spec §6 形态 A 接缝）：外壳 renderTimeline 遇 Task 块委托此函数。
 *  §9.5/D14：skip_transcript 子代理不进内联时间线（返回 null → 节点连同子块消失）；flat（右侧）语境不过滤。 */
export function timelineMount(block: Extract<Block, { type: 'tool_use' }>, ctx: SaCtx): ReactNode {
  const subagents = subagentsOf(ctx.sliceState)
  // 实时态读运行时 meta；重载态 meta 已清空 → 读持久化在 Task 块上的 skipTranscript（daemon 回填），保证重载后 §9.5 仍成立。
  if (!ctx.flat && (subagents[block.id]?.skipTranscript || block.skipTranscript)) return null
  return ctx.flat ? <DelegateRow block={block} ctx={ctx} /> : <SubagentNode block={block} ctx={ctx} />
}

/** 上·header 挂载（spec §6 形态 C）：头像身份入口——前 2 头像 + >2 末尾虚线圈 ⋯；无子代理整块不渲染（D7/D8）。 */
export function headerEntry(ctx: SliceViewCtx): ReactNode {
  const agents = subagentList(subagentsOf(ctx.sliceState))
  if (agents.length === 0) return null
  return (
    <button className="sa-entry" title="查看 Subagent（在右侧实时展示）" onClick={() => ctx.onShowAgents?.()}>
      <span className="sa-stack">
        {agents.slice(0, 2).map((m) => {
          const t = m.subagentType || 'subagent'
          return <span key={m.taskId} className={`sa-ava ${saAvatarClass(t)}`}>{saAvatarLetter(t)}</span>
        })}
        {agents.length > 2 && <span className="sa-ava sa-ava-more">⋯</span>}
      </span>
    </button>
  )
}

/** 形态 B 子代理聚合面板（Gallery/Board 自管内部 saView 切换）。 */
function AgentsPanel({ ctx }: { ctx: SliceViewCtx }) {
  const subagents = subagentsOf(ctx.sliceState)
  const agents = subagentList(subagents)
  const runCount = agents.filter((a) => a.status === 'running').length
  const allBlocks = ctx.blocks
  const childrenOf = buildChildrenMap(allBlocks)
  const resultMap = buildResultMap(allBlocks)
  // 形态 B 子视图：Gallery（网格自适应）/ Board（横排看板），默认 Gallery（spec D10）。
  const [saView, setSaView] = useState<'gallery' | 'board'>('gallery')
  // 委托行点击 → 滚到对应子代理卡片（按 taskId 锚点）
  const onJump = (taskId: string) => {
    const el = document.querySelector(`[data-sacard="${taskId}"]`)
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
  }
  const saCtx: SaCtx = { resultMap, childrenOf, sliceState: subagents, mountTask: timelineMount, onOpenCommand: ctx.onOpenCommand, projectRoot: ctx.projectRoot, flat: true, onJump }
  return (
    <>
      <div className="sa-pbar">
        <span><b>{agents.length} 个 Subagent</b> · {runCount} 个运行中</span>
        <span className="sa-viewseg">
          <button className={`sa-vbtn${saView === 'gallery' ? ' is-active' : ''}`} type="button" onClick={() => setSaView('gallery')}>Gallery</button>
          <button className={`sa-vbtn${saView === 'board' ? ' is-active' : ''}`} type="button" onClick={() => setSaView('board')}>Board</button>
        </span>
      </div>
      <div className={`sa-plist ${saView}`}>
        {agents.map((m) => {
          const t = m.subagentType || 'subagent'
          const stat = SA_STAT[m.status]
          const tuid = m.toolUseId
          const children = tuid ? (childrenOf.get(tuid) ?? []) : []
          // 父级标注（D16 扁平+↳隶属）：本子代理的 Task 块若 parent 指向另一子代理 → 标父类型
          const myBlock = tuid ? allBlocks.find((b) => b.type === 'tool_use' && (b as { id: string }).id === tuid) : undefined
          const parentTuid = (myBlock as { parentToolUseId?: string } | undefined)?.parentToolUseId
          const parentType = parentTuid ? (subagents[parentTuid]?.subagentType) : undefined
          return (
            <div key={m.taskId} data-sacard={m.taskId} className={`sa-card${m.status === 'running' ? ' is-run' : ''}`}>
              <div className="sa-card-head">
                <span className={`sa-ava ${saAvatarClass(t)}`}>{saAvatarLetter(t)}</span>
                <span className="sa-name">{t}</span>
                {parentType && <span className="sa-parent">↳ 隶属 {parentType}</span>}
                <span className={`sa-stat ${stat.cls}`}>{stat.label}</span>
              </div>
              <div className="sa-card-body">
                {m.description && <div className="sa-task">{m.description}</div>}
                <div className="chat-timeline">{renderTimeline(children, saCtx)}</div>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}

/** 右·面板挂载（spec §6 形态 B）：返回 Subagent 视图槽（有子代理才显示，对齐原「无子代理→无 tab」）。 */
export function rightViews(ctx: SliceViewCtx): ViewSlot[] {
  const agents = subagentList(subagentsOf(ctx.sliceState))
  return [{
    id: 'agents',
    tabLabel: <>Subagent <span className="cnt">{agents.length}</span></>,
    hasContent: agents.length > 0,
    render: () => <AgentsPanel ctx={ctx} />,
  }]
}
