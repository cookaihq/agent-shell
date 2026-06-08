import type { Engine, ProgressActivity } from '@agent-shell/contracts'
import type { AgentSlice } from './types'
import { claudeEventSchema } from './claude/events'
import { codexEventSchema } from './codex/events'
import { claudeChatUIConfig } from './claude/chatUIConfig'
import { codexChatUIConfig } from './codex/chatUIConfig'
import { claudeRebuildBlocks } from './claude/history'
import { codexRebuildBlocks, codexRebuildSliceState } from './codex/history'
import { initSubagentState, subagentReduce, timelineMount, headerEntry, rightViews } from './claude/subagent'
import {
  initCodexSubagentState,
  codexSubagentReduce,
  timelineMount as codexTimelineMount,
  headerEntry as codexHeaderEntry,
  rightViews as codexRightViews,
} from './codex/subagent'

/**
 * 轻量 Agent 切片注册表（右尺寸，非 Claudian 全套 Registry）。
 *
 * 外壳代码一律通过 `SLICES[engine]` 或 `getSlice(engine)` 访问切片，
 * 满足「零 if(agent === 'claude')」铁律（spec §3.4）。
 *
 * task 1.4：activityLabel 已下沉到 claudeSlice（claude 工具名→中文，切片私有知识）。
 * codexSlice 不实现（codex 不发 tool 进度事件）。
 */

// 取路径末段做简短展示；命令类 target 不在此展示。
const baseName = (p: string): string => p.split('/').pop() || p

function claudeActivityLabel(a: ProgressActivity): string {
  if (a.kind === 'thinking') return '思考中'
  if (a.kind === 'responding') return '撰写回复'
  const file = a.target ? baseName(a.target) : ''
  if (/^(Edit|Write|MultiEdit)$/.test(a.tool)) return file ? `正在编辑 ${file}` : '正在编辑'
  if (a.tool === 'Read') return file ? `正在读取 ${file}` : '正在读取'
  if (a.tool === 'Bash') return '正在运行命令'
  if (a.tool === 'TodoWrite') return '更新任务计划'
  return a.tool ? `正在调用 ${a.tool}` : '处理中'
}

/**
 * claude 模型上下文窗口表（仅已核实的值；不臆造）：
 *   - model id 含 '1m'（大小写不敏感）→ 1M 上下文（claude-opus-4-8[1m] 等）
 *   - 其余 → 200k（standard claude 窗口，当前已知默认）
 */
function claudeContextWindowSize(model: string): number {
  return /1m/i.test(model) ? 1_000_000 : 200_000
}

// eventSchema：claude 私有事件（permission/ask/resolved/structured/subagent），与共享生命周期并集后 safeParse。
// historyService：claude 重建含 msg_id 提取（§8，唯一 per-agent 历史分支）。
// subagent 整条链（spec §6 Phase 2）：私有累计态 initSliceState/reduce + 三挂载槽 timelineMount/headerEntry/rightViews。
const claudeSlice: AgentSlice = {
  engine: 'claude',
  activityLabel: claudeActivityLabel,
  getContextWindowSize: claudeContextWindowSize,
  eventSchema: claudeEventSchema,
  chatUIConfig: claudeChatUIConfig,
  historyService: { rebuildBlocks: claudeRebuildBlocks },
  initSliceState: initSubagentState,
  reduce: subagentReduce,
  timelineMount,
  headerEntry,
  rightViews,
  supportsFileRewind: true,   // enableFileCheckpointing 已在 startTurn 开启；rewindFiles 接口可用
  showsUnloggedBanner: true,  // claude 有本机登录态实测：cli-login 来源 + 未登录 → 显示引导 banner
}
// codex 窗口表待补：无核实的 GPT 上下文窗口值，暂省略 → 回落默认（不臆造数值）
// eventSchema：codex 私有事件 = CodexSubagentEvent（多 thread 子代理 fanout），与共享生命周期并集后 safeParse。
// historyService：codex 重建仅共享骨架（无 msg_id）。
// 子代理整条链（spec §4.2/§6）：threadId 索引的私有累计态 initSliceState/reduce + 三挂载槽（形态 A/C/B 照原型 cxp-*）。
const codexSlice: AgentSlice = {
  engine: 'codex',
  eventSchema: codexEventSchema,
  chatUIConfig: codexChatUIConfig,
  historyService: { rebuildBlocks: codexRebuildBlocks, rebuildSliceState: codexRebuildSliceState },
  initSliceState: initCodexSubagentState,
  reduce: codexSubagentReduce,
  timelineMount: codexTimelineMount,
  headerEntry: codexHeaderEntry,
  rightViews: codexRightViews,
}

export const SLICES: Record<Engine, AgentSlice> = {
  claude: claudeSlice,
  codex: codexSlice,
}

export function getSlice(engine: Engine): AgentSlice {
  return SLICES[engine]
}
