import type { ReactNode } from 'react'
import type { Engine, ProgressActivity, ZodTypeAny, TranscriptRecord } from '@agent-shell/contracts'
import type { MessageDTO, AgentEvent, Block } from '../../api/types'
import type { SaCtx, OpenCommand } from '../timeline'
import type { DiffPayload } from '../blocks/DiffModal'

/**
 * Per-Agent slice contract — 轻量骨架，后续隔离任务按需扩充。
 *
 * 本接口是每个 Agent 引擎的纵向切片入口。外壳一律经此接口碰 Agent 知识，
 * 满足铁律「功能层 / 外壳层零 if(agent==='x')」（spec §14.3）。
 *
 * 成员：
 *   - engine            — 引擎标识符
 *   - activityLabel     (spec §4.4) — 把运行中「当前动作」翻成中文状态行文案
 *   - getContextWindowSize (spec §4.4) — 模型 → 上下文窗口大小（运行时权威值到来前的回落）
 *   - eventSchema       (spec §4.5) — 切片私有事件 schema（useAgentStream safeParse）
 *   - chatUIConfig      (spec §7) — 运行时档位控件描述符（喂 ModelPill / RuntimeSwitcher）
 *   - historyService    (spec §8) — transcript 原始 records → MessageDTO[] 重建（历史===实时同套切片解析）
 *
 * 待后续任务逐步添加（YAGNI，不预先定义）：
 *   - interpretToolBlock / timelineMount / headerEntry / rightViews / reduce
 */

/** 历史会话重建服务（spec §8）：transcript 原始 records → 中立 MessageDTO[]。
 *  共享骨架（user_prompt/assistant_blocks + collapseStreamingText）+ 切片私有（claude 提取 msg_id；codex 无）。 */
export interface HistoryService {
  rebuildBlocks(records: TranscriptRecord[]): MessageDTO[]
  /**
   * 重载时重建切片私有累计态（spec §5.4 sliceState 槽，P5c）。
   * 切片从 transcript records 里 replay 自己落库的私有块（如 codex_subagent），经同一份 reduce 还原 sliceState
   * → 重载形态 A/B/C 与 live 一致（live===重载）。缺省（如 claude）→ 外壳回落 initSliceState()。
   * 复用 reduce 作单一真相，不另写一套重建逻辑。
   */
  rebuildSliceState?(records: TranscriptRecord[]): unknown
}

// ── 三挂载槽（spec §6）：subagent 整条链归切片，外壳只提供槽位、不读切片私有状态（SubagentMeta）──
//
// 切片私有累计态（subagent map）由 `reduce` 维护，挂在 ChatState 的 `sliceState` 槽（外壳持有但不解释，spec §5.4）。
// 外壳把这个不透明值原样喂回三个挂载点；切片自行 cast 成自家形状（如 Record<string,SubagentMeta>）。

/** 右栏视图槽（spec §6 形态 B）：切片产出一个「tab + panel」，外壳把它塞进 FileWorkspace 的视图轴。 */
export interface ViewSlot {
  /** 视图唯一键（react key + data-fw + rightView 判别）。 */
  id: string
  /** tab 上的文案（如「Subagent」）。 */
  tabLabel: ReactNode
  /** 该视图是否有内容（无内容 → 外壳不显示 tab，对齐原「无子代理→无 tab」）。 */
  hasContent: boolean
  /** 渲染整个面板体（切片自管内部状态如 Gallery/Board 切换）。 */
  render(): ReactNode
}

/** 三挂载点共享的渲染语境（外壳提供中立数据 + 不透明 sliceState；切片自行解释）。 */
export interface SliceViewCtx {
  /** 切片私有累计态（外壳不解释；切片 cast 成自家形状）。 */
  sliceState: unknown
  /** 当前全部块（messages 扁平 + liveBlocks）：切片据 parentToolUseId 切分各 subagent 迷你时间线。 */
  blocks: Block[]
  /** 点击工具行 → 右侧开命令/文件 tab（复用外壳 onOpenCommand）。 */
  onOpenCommand?: (cmd: OpenCommand) => void
  /** 项目根绝对路径（卡片内 OpCard 路径精简用）。 */
  projectRoot?: string
  /** header 头像入口点击信号（形态 C→B 联动；外壳透传 seq，切片回 onShowAgents）。 */
  onShowAgents?: () => void
}

export interface AgentSlice {
  engine: Engine
  /** 把运行中「当前动作」翻成中文状态行文案（claude 工具名→中文；切片私有知识）。缺省 → 外壳回落「处理中…」。 */
  activityLabel?(activity: ProgressActivity): string
  /**
   * 切片模型 → 上下文窗口大小（token 数），作运行时权威值到来前 / 重载的回落。
   * 缺省 → 外壳用 200k 默认（不臆造数值，由切片自己决定是否声明）。
   */
  getContextWindowSize?(model: string): number | undefined
  /** 切片私有事件 schema；useAgentStream 按 engine 取「共享 ∪ 此」safeParse（缺省 → 仅共享）。 */
  eventSchema?: ZodTypeAny
  /** 运行时档位控件描述符（spec §7）。外壳 ModelPill/RuntimeSwitcher 渲染切片返回的描述符，不分支 Agent。 */
  chatUIConfig: ChatUIConfig
  /** 历史重建（spec §8）：外壳 loadHistory 经此把 transcript records 重建成 MessageDTO[]，零 Agent 名分支。 */
  historyService: HistoryService

  // ── 私有状态子 reducer + 三挂载槽（spec §5.4/§6；缺省 → 外壳该挂载点空，codex 即此）──

  /** 切片私有累计态初值（spec §5.4 sliceState 槽）。缺省 → 外壳存 undefined。 */
  initSliceState?(): unknown
  /**
   * 私有状态纯函数 reducer（spec §5.4）：外壳把不归外壳解释的事件（如 subagent）委托给它。
   * 外壳永不触碰 sliceState 内部结构——只持有、只透传。返回新 sliceState。
   */
  reduce?(sliceState: unknown, ev: AgentEvent): unknown

  /**
   * 左·时间线挂载（spec §6 形态 A）：外壳 renderTimeline 遇到 Task 工具块时委托此函数渲染子代理节点。
   * ctx 携带中立配对/嵌套数据 + 不透明 sliceState（ctx.sliceState）；缺省 → Task 块在时间线不特殊渲染（codex）。
   */
  timelineMount?(block: Extract<Block, { type: 'tool_use' }>, ctx: SaCtx): ReactNode
  /** 上·header 挂载（spec §6 形态 C）：渲染头像身份入口。缺省 → header 无 subagent 入口（codex）。 */
  headerEntry?(ctx: SliceViewCtx): ReactNode
  /** 右·面板挂载（spec §6 形态 B）：返回若干右栏视图槽（如 Subagent Gallery/Board）。缺省 → 右栏无 subagent 视图（codex）。 */
  rightViews?(ctx: SliceViewCtx): ViewSlot[]
  /** 是否支持文件检查点回退（claude 开启 enableFileCheckpointing；codex 无）。缺省 false。 */
  supportsFileRewind?: boolean
  /**
   * 当活动凭证来源是「本机 CLI 登录」却未登录时，是否在会话区显示未登录引导 banner。
   * 仅 claude 有本机登录态实测；codex 登录后置 Part A（cliLogin 固定 unknown）→ 缺省 false（不显示）。
   */
  showsUnloggedBanner?: boolean
}

export type { SaCtx, OpenCommand, DiffPayload }

// ── 运行时档位中立状态（外壳持有，spec §7）────────────────────────────────────
// 外壳只存 string，不解释 'acceptEdits'/'workspace-write' 的语义。

/** 神立 RuntimeState：engine + 中立档位槽（全 string）。 */
export interface RuntimeSlots {
  /** 当前引擎。 */
  engine: Engine
  /** 模型 id（发给 daemon/SDK）。 */
  model: string
  /** 中立 effort 槽（renderer 名；POST 时映射成 daemon 的 effort）。 */
  reasoning: string
  /** 中立 claude-permission 槽（claude 5 档权限值；codex 不用）。 */
  permissionMode: string
  /** 通用多段选择器槽（slotId → 选中值）；codex 审批/沙箱住这里。 */
  modeSelections?: Record<string, string>
}

// ── chatUIConfig 描述符（切片产出，外壳渲染）──────────────────────────────────

/** 中立风险枚举（外壳据此 RISK_COLOR 上色，不解释语义）。 */
export type RiskLevel = 'low' | 'mid' | 'ask' | 'high'

/** 脸上的档位 chip：risk 有 → 画 dot+tag；无 → 仅 tag（如 effort）。 */
export interface RuntimeChip {
  /** 唯一键（react key）。 */
  key: string
  /** 展示文案。 */
  text: string
  /** 风险等级；有则外壳画彩色 dot。 */
  risk?: RiskLevel
}

/** 模型选项（下拉 / flyout 项）。 */
export interface UIModelOption {
  value: string
  label: string
  description?: string
}

/** 模型段描述：折叠态与平铺态、当前项、分组标题。 */
export interface ModelSection {
  /** 全部可选模型（对齐后）。 */
  list: UIModelOption[]
  /** 当前选中项（查不到回落列表首个）。 */
  current: UIModelOption | undefined
  /** 折叠态（claude）→ 只画当前项 + caret，点开 flyout；平铺态（codex）→ 列全部。 */
  collapsed: boolean
  /** 分组标题（如「Claude Code · 动态」）。 */
  groupLabel: string
}

/** 多段权限/审批选择器的一段：写哪个中立槽 + 选项 + 当前值。 */
export interface ModeSegment {
  /** react key + 标题（如「权限」「审批策略」「沙箱级别」）。 */
  key: string
  title: string
  /** 写回的中立槽：'permissionMode' 直写顶层；其余写 modeSelections[slot]。 */
  slot: string
  options: { id: string; zh: string; en: string }[]
  current: string
}

/** Effort 点滑条段。 */
export interface EffortSection {
  options: { id: string; zh: string; en: string }[]
  current: { id: string; zh: string; en: string } | undefined
}

/**
 * 运行时档位控件描述符集合（spec §7）。
 * 切片产出「描述符」，外壳 ModelPill/RuntimeSwitcher 据此渲染——外壳零 Agent 分支。
 */
export interface ChatUIConfig {
  /** model-btn / chip 上的模型展示名（value → displayName）。 */
  getModelLabel(value: string, dyn?: UIModelOption[] | null): string
  /** 弹窗模型段（折叠/平铺、当前项、分组标题、全列表）。 */
  getModelSection(state: RuntimeSlots, dyn?: UIModelOption[] | null, providerModels?: UIModelOption[]): ModelSection
  /** RuntimeSwitcher 下拉用的扁平模型列表（label 已解析）。 */
  getModelOptions(state: RuntimeSlots, dyn?: UIModelOption[] | null, providerModels?: UIModelOption[]): UIModelOption[]
  /** 权限/审批多段选择器（claude 1 段；codex 2 段）。 */
  getModeSelector(state: RuntimeSlots): ModeSegment[]
  /** Effort 点滑条段（缺省 → 无 effort 段）。 */
  getEffortSection?(state: RuntimeSlots): EffortSection | null
  /** 脸上的档位 chip 列表（取代 chipPerm/chipEffort）；外壳只画 dot+tag。 */
  getRuntimeChips(state: RuntimeSlots): RuntimeChip[]
  /** 是否支持动态模型列表（claude 拉 supportedModels；codex 无）。 */
  supportsDynamicModels?: boolean
  /**
   * 切片中立槽默认值（外壳初值/回落用，不解释语义）。
   * 外壳据此初始化 RuntimeState，不在外壳硬编码各引擎默认档位。
   */
  getDefaultSlots(): { reasoning: string; permissionMode: string; modeSelections?: Record<string, string> }
}
