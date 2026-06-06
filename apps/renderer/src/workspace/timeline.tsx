/**
 * timeline.ts — 时间线渲染中立骨架（外壳层，spec §5.2/§5.3/§6）。
 *
 * 外壳拥有时间线的「结构」：配对（buildResultMap）/嵌套（buildChildrenMap）/遍历（renderTimeline）/
 * 中立块→视图（blockInner）。这些只认中立字段（type/id/name/parentToolUseId/tool），不读 Agent 私有状态。
 *
 * 接缝（spec §6）：renderTimeline 遇 `Task` 工具块时**委托切片**（ctx.mountTask）渲染子代理节点——
 * 外壳不内联 SubagentNode/DelegateRow、不读 SubagentMeta。无 mountTask 的切片（codex）→ Task 块不特殊渲染。
 * `skipTranscript`（§9.5）的过滤也归切片：mountTask 返回 null → 该节点连同其子块（仅经此递归可达）一并消失。
 */
import type { ReactNode } from 'react'
import type { Block } from '../api/types'
import { OpCard, kindOf } from './blocks/OpCard'
import type { DiffPayload } from './blocks/DiffModal'
import { TodoCard } from './blocks/TodoCard'
import { Thinking } from './blocks/Thinking'
import { SkillRow } from './blocks/SkillRow'
import { renderMarkdown } from '../runtime/markdown'

/** 点击工具卡 → 右侧详情 tab 的载荷（命令/读取/编辑通用）。command=IN 文本，output=OUT 文本。 */
export interface OpenCommand {
  id: string
  command: string
  output: string
  ok: boolean
  tabLabel?: string   // tab 标签（读取/编辑用文件名；命令缺省用 $ 首词）
  inLabel?: string    // IN 段标题（缺省「命令」）
  outLabel?: string   // OUT 段标题（缺省「输出」）
}

// toolUseId → tool_result 块（配对工具状态/输出）
export function buildResultMap(blocks: Block[]): Map<string, { ok: boolean; content: string; completedAt?: number }> {
  const map = new Map<string, { ok: boolean; content: string; completedAt?: number }>()
  for (const b of blocks) {
    if (b.type === 'tool_result') map.set(b.toolUseId, { ok: b.ok, content: b.content, completedAt: b.completedAt })
  }
  return map
}

// 按 parentToolUseId 分组（subagent 就地嵌套）：键 = 派生子代理的 Task tool_use id，值 = 该子代理的块。
export function buildChildrenMap(blocks: Block[]): Map<string, Block[]> {
  const map = new Map<string, Block[]>()
  for (const b of blocks) {
    const p = (b as { parentToolUseId?: string }).parentToolUseId
    if (p) { const arr = map.get(p) ?? []; arr.push(b); map.set(p, arr) }
  }
  return map
}

/** 渲染一棵时间线所需的全部中立上下文（递归共享，避免逐层传参）。 */
export interface SaCtx {
  resultMap: Map<string, { ok: boolean; content: string; completedAt?: number }>
  childrenOf: Map<string, Block[]>
  /** 切片私有累计态（外壳不解释；mountTask 内部 cast 成自家形状如 SubagentMeta map）。 */
  sliceState?: unknown
  /** 左·时间线 Task 块委托渲染（spec §6 接缝）：返回 null/undefined → 该节点不渲染（含 skipTranscript 过滤）。 */
  mountTask?: (block: Extract<Block, { type: 'tool_use' }>, ctx: SaCtx) => ReactNode
  onOpenCommand?: (cmd: OpenCommand) => void
  onOpenDiff?: (d: DiffPayload) => void
  projectRoot?: string
  /** 右侧聚合面板语境（形态 B）：Task 块渲染为「委托 X」扁平跳转行而非递归嵌套（D16）。 */
  flat?: boolean
  /** flat 下点击「委托 X」行 → 跳到对应子代理卡片（按 taskId）。 */
  onJump?: (taskId: string) => void
}

type ToolState = 'running' | 'ok' | 'err'
/** 工具圆点状态色：进行中→橙脉冲 / 成功→绿 / 失败→红（对齐 VS Code 对齐设计 §5）。 */
const toolDot = (s: ToolState): string => (s === 'running' ? 'run' : s === 'ok' ? 'green' : 'red')

/** 中立块（text/thinking/工具）→ {圆点类, 卡片内容}。Task/AskUserQuestion/tool_result 由调用方另处理 → null。
 *  圆点按状态着色（绿/红/橙），思考·正文→灰，技能→紫；工具走清爽行（OpCard）。 */
export function blockInner(block: Block, ctx: SaCtx): { dotKind: string; inner: ReactNode } | null {
  if (block.type === 'text') {
    return { dotKind: 'gray', inner: <div className="prose prose-block">{renderMarkdown(block.text)}</div> }
  }
  if (block.type === 'thinking') {
    return { dotKind: 'gray', inner: <Thinking text={block.text} elapsedMs={block.elapsedMs} /> }
  }
  if (block.type === 'tool_use') {
    const kind = block.tool ?? kindOf(block.name)
    const result = ctx.resultMap.get(block.id)
    const state: ToolState = result === undefined ? 'running' : result.ok ? 'ok' : 'err'
    // 技能：紫点清爽头行（描述取注入的 SKILL.md frontmatter）
    if (kind === 'skill') {
      return {
        dotKind: 'skill',
        inner: <SkillRow input={block.input} resultContent={result?.content} startedAt={block.startedAt} completedAt={result?.completedAt} />,
      }
    }
    if (kind === 'todo') {
      const inp = block.input as { todos?: Array<{ content: string; status: string }> }
      return { dotKind: toolDot(state), inner: <TodoCard todos={inp.todos ?? []} /> }
    }
    // 点击工具卡 → 右侧详情 tab（命令/读取/编辑通用）
    const bi = block.input as { command?: unknown; file_path?: unknown; path?: unknown; new_string?: unknown }
    const filePath = (typeof bi.file_path === 'string' ? bi.file_path : typeof bi.path === 'string' ? bi.path : '') as string
    const fileName = filePath ? (filePath.split('/').pop() || filePath) : ''
    let detail: OpenCommand | undefined
    if (ctx.onOpenCommand) {
      const ok = result?.ok ?? false
      const out = result?.content ?? ''
      if (kind === 'bash' && typeof bi.command === 'string') detail = { id: block.id, command: bi.command, output: out, ok }
      else if (kind === 'read' && filePath) detail = { id: block.id, command: filePath, output: out, ok, tabLabel: fileName, inLabel: '文件', outLabel: '内容' }
      else if (kind === 'edit' && filePath) detail = { id: block.id, command: filePath, output: (typeof bi.new_string === 'string' ? bi.new_string : out), ok, tabLabel: fileName, inLabel: '文件', outLabel: '新内容' }
    }
    const onOpen = detail ? () => ctx.onOpenCommand!(detail!) : undefined
    return {
      dotKind: toolDot(state),
      inner: (
        <OpCard name={block.name} tool={block.tool} input={block.input} result={result ?? null} startedAt={block.startedAt} completedAt={result?.completedAt} projectRoot={ctx.projectRoot} onOpen={onOpen} onOpenDiff={ctx.onOpenDiff} />
      ),
    }
  }
  return null
}

/** 递归渲染一串块为时间线节点（中立骨架）：Task → 委托切片 mountTask；tool_result/AskUserQuestion 结构级跳过；其余 → 中立节点。 */
export function renderTimeline(blocks: Block[], ctx: SaCtx): ReactNode[] {
  const items: ReactNode[] = []
  blocks.forEach((block, i) => {
    if (block.type === 'tool_result') return   // 已由配对 tool_use 渲染
    if (block.type === 'tool_use' && block.name === 'AskUserQuestion') return   // 由聊天内选择卡呈现
    if (block.type === 'tool_use' && block.name === 'Task') {
      // 接缝：Task 块整条委托切片渲染（SubagentNode / 委托行 / skipTranscript 过滤皆在切片内）。
      // mountTask 返回 null/undefined（无切片贡献 = codex，或 skipTranscript 过滤）→ 该节点不进时间线。
      const node = ctx.mountTask?.(block, ctx)
      if (node) items.push(<TaskMount key={i}>{node}</TaskMount>)
      return
    }
    const r = blockInner(block, ctx)
    if (!r) return
    items.push(
      <div key={i} className="tl-item">
        <span className={`tl-dot ${r.dotKind}`} />
        <div className="tl-body">{r.inner}</div>
      </div>,
    )
  })
  return items
}

/** 给委托节点套一个稳定 key 容器（切片节点自带 DOM；外壳只负责列表 key）。 */
function TaskMount({ children }: { children: ReactNode }) {
  return <>{children}</>
}
