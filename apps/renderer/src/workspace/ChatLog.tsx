import { useRef, useEffect, useState, type ReactNode } from 'react'
import { api } from '../api/client'
import type { Block, MessageDTO, Engine, SubagentMeta } from '../api/types'
import type { RunStatus, ProgressActivity } from './chatReducer'
import { OpCard, kindOf } from './blocks/OpCard'
import { DiffModal, type DiffPayload } from './blocks/DiffModal'
import { RawModal } from './blocks/RawModal'
import { TodoCard } from './blocks/TodoCard'
import { Thinking } from './blocks/Thinking'
import { WorkStatus } from './WorkStatus'
import { AGENT_LABEL } from './runtimeState'
import { useSettings } from '../settings/SettingsContext'
import { IconStop, IconPlay } from '../ui/icons'
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

interface ChatLogProps {
  messages: MessageDTO[]
  liveBlocks: Block[] | null
  runStatus: RunStatus
  failReason?: string
  /** 运行中的实时进度（驱动底部 WorkStatus 状态行）；turn_end 后由 reducer 清空 → 本行消失。 */
  liveProgress?: { tokens: number; activity: ProgressActivity }
  onResume: () => void
  /** 点击运行命令卡 → 右侧开命令 tab。 */
  onOpenCommand?: (cmd: OpenCommand) => void
  engine?: Engine
  /** 当前项目根绝对路径（读取/编辑卡路径精简用，Issue 9）。 */
  projectRoot?: string
  /** 当前项目 id（附件内嵌图片走 rawUrl 取流用，Issue 26）。 */
  projectId?: string
  /** 当前会话 id（调试模式点 🐞 取原始记录用）。 */
  sessionId?: string
}

// 把毫秒时间戳格式化为本地 HH:mm（两位补零）
function formatTime(createdAt: number): string {
  const d = new Date(createdAt)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

// Build a map from toolUseId → tool_result block for pairing
function buildResultMap(blocks: Block[]): Map<string, { ok: boolean; content: string; completedAt?: number }> {
  const map = new Map<string, { ok: boolean; content: string; completedAt?: number }>()
  for (const b of blocks) {
    if (b.type === 'tool_result') {
      map.set(b.toolUseId, { ok: b.ok, content: b.content, completedAt: b.completedAt })
    }
  }
  return map
}

// 按 parentToolUseId 分组（形态 A 就地嵌套）：键 = 派生子代理的 Task tool_use id，值 = 该子代理的块。
function buildChildrenMap(blocks: Block[]): Map<string, Block[]> {
  const map = new Map<string, Block[]>()
  for (const b of blocks) {
    const p = (b as { parentToolUseId?: string }).parentToolUseId
    if (p) { const arr = map.get(p) ?? []; arr.push(b); map.set(p, arr) }
  }
  return map
}

// ── 子代理头行（形态 A）展示辅助：头像首字母+类型色、状态徽章、用量 ──
const SA_AVA_COLORS = ['general', 'research', ''] as const   // amber / purple / blue(默认无修饰)
// 类型名 → 稳定色类（同一类型恒定同色，避免渲染抖动；'' = 默认蓝）
function saAvatarClass(type: string): string {
  let h = 0
  for (let i = 0; i < type.length; i++) h = (h * 31 + type.charCodeAt(i)) >>> 0
  return SA_AVA_COLORS[h % SA_AVA_COLORS.length]
}
function saAvatarLetter(type: string): string {
  const m = type.match(/[a-z0-9]/i)
  return (m ? m[0] : '?').toUpperCase()
}
// 状态 → 徽章文案+类（color token：run 橙 / done 绿 / fail 红 / stop 灰，对齐 spec §4A 决议）
const SA_STAT: Record<SubagentMeta['status'], { label: string; cls: string }> = {
  running: { label: '运行中', cls: 'run' },
  completed: { label: '完成', cls: 'done' },
  failed: { label: '失败', cls: 'fail' },
  stopped: { label: '中止', cls: 'stop' },
}
const fmtTok = (n: number): string => (n < 1000 ? `${n}` : `${(n / 1000).toFixed(1)}k`)
function fmtSaMeta(usage?: SubagentMeta['usage']): string {
  if (!usage) return ''
  const parts: string[] = []
  if (usage.toolUses) parts.push(`${usage.toolUses} 工具`)
  if (usage.totalTokens) parts.push(`${fmtTok(usage.totalTokens)} tok`)
  if (usage.durationMs) parts.push(`${Math.round(usage.durationMs / 1000)}s`)
  return parts.join(' · ')
}

/** 渲染一棵子代理时间线所需的全部上下文（递归共享，避免逐层传参）。 */
interface SaCtx {
  resultMap: Map<string, { ok: boolean; content: string; completedAt?: number }>
  childrenOf: Map<string, Block[]>
  subagents: Record<string, SubagentMeta>
  onOpenCommand?: (cmd: OpenCommand) => void
  onOpenDiff?: (d: DiffPayload) => void
  projectRoot?: string
}

/** 普通块（text/thinking/工具）→ {圆点类, 卡片内容}。Task/AskUserQuestion/tool_result 由调用方另处理 → null。 */
function blockInner(block: Block, ctx: SaCtx): { dotKind: string; inner: ReactNode } | null {
  if (block.type === 'text') {
    return { dotKind: 'text', inner: <div className="prose prose-block">{renderMarkdown(block.text)}</div> }
  }
  if (block.type === 'thinking') {
    return { dotKind: 'thinking', inner: <Thinking text={block.text} elapsedMs={block.elapsedMs} /> }
  }
  if (block.type === 'tool_use') {
    const kind = kindOf(block.name)
    const result = ctx.resultMap.get(block.id)
    if (kind === 'todo') {
      const inp = block.input as { todos?: Array<{ content: string; status: string }> }
      return { dotKind: 'tool', inner: <TodoCard todos={inp.todos ?? []} /> }
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
      dotKind: 'tool',
      inner: (
        <OpCard name={block.name} input={block.input} result={result ?? null} startedAt={block.startedAt} completedAt={result?.completedAt} projectRoot={ctx.projectRoot} onOpen={onOpen} onOpenDiff={ctx.onOpenDiff} />
      ),
    }
  }
  return null
}

/** 子代理头行（形态 A）：蓝点 + 头像 + 类型 + Subagent 标签 + 描述 + 状态 + 用量 + 折叠箭头；
 *  默认折叠（D9），点开见蓝导轨缩进的内部迷你时间线（递归 renderTimeline，支持多层 D16）。 */
function SubagentNode({ block, ctx }: { block: Extract<Block, { type: 'tool_use' }>; ctx: SaCtx }) {
  const meta = ctx.subagents[block.id]
  const inp = block.input as { subagent_type?: string; description?: string }
  // 类型/描述：优先实时 meta（来自 system 消息）；缺省退 Task input（history 重载时无 meta，靠持久化的 Task 块兜底）
  const type = meta?.subagentType || (typeof inp?.subagent_type === 'string' ? inp.subagent_type : '') || 'subagent'
  const desc = meta?.description ?? (typeof inp?.description === 'string' ? inp.description : '')
  const result = ctx.resultMap.get(block.id)
  // 状态：有 meta 用 meta.status；无 meta（重载）→ 据 Task tool_result 在否推断终态/运行中
  const status: SubagentMeta['status'] = meta?.status ?? (result ? (result.ok ? 'completed' : 'failed') : 'running')
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

/** 递归渲染一串块为时间线节点：Task → 子代理头行（嵌套）；其余 → 普通节点。tool_result/AskUserQuestion 跳过。 */
function renderTimeline(blocks: Block[], ctx: SaCtx): ReactNode[] {
  const items: ReactNode[] = []
  blocks.forEach((block, i) => {
    if (block.type === 'tool_result') return   // 已由配对 tool_use 渲染
    if (block.type === 'tool_use' && block.name === 'AskUserQuestion') return   // 由聊天内选择卡呈现
    if (block.type === 'tool_use' && block.name === 'Task') {
      items.push(<SubagentNode key={i} block={block} ctx={ctx} />)
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

interface BlocksViewProps {
  blocks: Block[]
  subagents: Record<string, SubagentMeta>
  onOpenCommand?: (cmd: OpenCommand) => void
  onOpenDiff?: (d: DiffPayload) => void
  projectRoot?: string
}

function BlocksView({ blocks, subagents, onOpenCommand, onOpenDiff, projectRoot }: BlocksViewProps) {
  const ctx: SaCtx = { resultMap: buildResultMap(blocks), childrenOf: buildChildrenMap(blocks), subagents, onOpenCommand, onOpenDiff, projectRoot }
  // 主线 = 未被「在场的 Task 块」收养的块（无 parentToolUseId，或其父 Task 不在本消息内 → 孤儿兜底平铺，不丢块）。
  const toolUseIds = new Set(blocks.filter((b) => b.type === 'tool_use').map((b) => (b as { id: string }).id))
  const topLevel = blocks.filter((b) => {
    const p = (b as { parentToolUseId?: string }).parentToolUseId
    return !p || !toolUseIds.has(p)
  })
  return <div className="chat-timeline">{renderTimeline(topLevel, ctx)}</div>
}

const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])
const isImagePath = (p: string) => IMG_EXT.has(p.toLowerCase().split('.').pop() ?? '')

interface MessageViewProps {
  message: MessageDTO
  engine: Engine
  subagents: Record<string, SubagentMeta>
  onOpenCommand?: (cmd: OpenCommand) => void
  onOpenDiff?: (d: DiffPayload) => void
  projectRoot?: string
  projectId?: string
  sessionId?: string
}

function MessageView({ message, engine, subagents, onOpenCommand, onOpenDiff, projectRoot, projectId, sessionId }: MessageViewProps) {
  const { debugMode } = useSettings()
  const [rawOpen, setRawOpen] = useState<unknown | null>(null)
  const time = formatTime(message.createdAt)

  if (message.role === 'user') {
    const text = message.blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    // 附件内嵌（Issue 26 ②）：图片走 rawUrl 缩略图，其它渲染文件 chip（名称 + 类型角标）
    const files = message.blocks
      .filter((b) => b.type === 'attachments')
      .flatMap((b) => (b as { type: 'attachments'; files: { name: string; path: string }[] }).files)
    return (
      <div className="msg user">
        <div className="role">你 <span className="rt">{time}</span></div>
        {text && <div className="user-text">{text}</div>}
        {files.length > 0 && (
          <div className="user-attach-grid">
            {files.map((f, i) => (
              isImagePath(f.path) && projectId ? (
                <a key={i} className="ua-img" href={api.rawUrl(projectId, f.path)} target="_blank" rel="noreferrer" title={f.name}>
                  <img src={api.rawUrl(projectId, f.path)} alt={f.name} loading="lazy" />
                </a>
              ) : (
                <span key={i} className="ua-chip" title={f.path}>
                  <span className="ua-ic">{(f.name.split('.').pop() || '·').slice(0, 3).toUpperCase()}</span>
                  <span className="ua-name">{f.name}</span>
                </span>
              )
            ))}
          </div>
        )}
      </div>
    )
  }

  // assistant
  return (
    <div className="msg assistant">
      <div className="role">
        {AGENT_LABEL[engine]} <span className="rt">{time}</span>
        {debugMode && message.sdkMessageId && (
          <button
            className="dbg-chip"
            type="button"
            title="查看原始记录"
            onClick={() => {
              if (message.sdkMessageId && sessionId) {
                api.rawRecord(sessionId, message.sdkMessageId).then((r) => setRawOpen(r.record)).catch(() => {})
              }
            }}
          >🐞 {message.sdkMessageId}{message.sdkUuid ? ` · ${message.sdkUuid.slice(0, 8)}` : ''}</button>
        )}
      </div>
      <BlocksView blocks={message.blocks} onOpenCommand={onOpenCommand} onOpenDiff={onOpenDiff} projectRoot={projectRoot} />
      {rawOpen != null && <RawModal json={rawOpen} onClose={() => setRawOpen(null)} />}
    </div>
  )
}

export function ChatLog({ messages, liveBlocks, runStatus, failReason, liveProgress, onResume, onOpenCommand, engine = 'claude', projectRoot, projectId, sessionId }: ChatLogProps) {
  // 编辑卡完整 diff 浮层（Issue 21）：点编辑卡在左侧会话区浮出
  const [diffModal, setDiffModal] = useState<DiffPayload | null>(null)
  const showNote = runStatus === 'aborted' || runStatus === 'failed'
  // 失败时显示真实原因（来自引擎 stderr / result 报错），而非只剩一句「任务失败」让人无从下手。
  const noteText =
    runStatus === 'aborted'
      ? '已中止当前任务 · 已完成的内容已保留'
      : failReason
        ? `任务失败 · ${failReason}`
        : '任务失败'

  // Build a synthetic live assistant message if there are live blocks
  const liveMessage: MessageDTO | null =
    liveBlocks && liveBlocks.length > 0
      ? {
          id: '__live__',
          sessionId: '',
          role: 'assistant',
          blocks: liveBlocks,
          createdAt: Date.now(),
        }
      : null

  const allMessages = liveMessage ? [...messages, liveMessage] : messages

  // Issue 26 ③：顶部固定显示最后一条 user 消息文本（截断），翻看历史时也常驻可见。
  const lastUserText = (() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]
      if (m.role !== 'user') continue
      const t = m.blocks.filter((b) => b.type === 'text').map((b) => (b as { type: 'text'; text: string }).text).join('').trim()
      if (t) return t
    }
    return ''
  })()

  // 智能贴底：默认跟随最新内容；用户手动往上翻看时不抢滚动，翻回底部后恢复跟随。
  const scrollRef = useRef<HTMLDivElement>(null)
  const stickRef = useRef(true) // 当前是否处于「贴底跟随」状态

  // 用户滚动时更新贴底状态：距底足够近（< 40px）算贴底，留阈值避免像素级抖动误判。
  function handleScroll() {
    const el = scrollRef.current
    if (!el) return
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 40
  }

  // 内容变化时，只有贴底状态才滚到最新；用户翻上去了就放手不动。
  useEffect(() => {
    if (!stickRef.current) return
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [messages, liveBlocks, liveProgress, runStatus, failReason])

  return (
    <>
      <div className="chat-log" ref={scrollRef} onScroll={handleScroll}>
        {lastUserText && (
          <div className="chat-sticky-user" title={lastUserText}>
            <span className="csu-label">最近发送</span>
            <span className="csu-text">{lastUserText}</span>
          </div>
        )}
        {allMessages.map((msg) => (
          <MessageView key={msg.id} message={msg} engine={engine} onOpenCommand={onOpenCommand} onOpenDiff={setDiffModal} projectRoot={projectRoot} projectId={projectId} sessionId={sessionId} />
        ))}
        {runStatus === 'running' && liveProgress && (
          <WorkStatus tokens={liveProgress.tokens} activity={liveProgress.activity} />
        )}
        {showNote && (
          <div className="run-note">
            <span className="rn-ic">
              <IconStop size={13} />
            </span>
            <span className="rn-txt">{noteText}</span>
            <button className="rn-resume" type="button" onClick={onResume}>
              <IconPlay size={12} />
              继续
            </button>
          </div>
        )}
      </div>
      {/* 完整 diff 浮层（Issue 21）：覆盖左侧会话区，不随消息滚动 */}
      {diffModal && <DiffModal payload={diffModal} onClose={() => setDiffModal(null)} />}
    </>
  )
}
