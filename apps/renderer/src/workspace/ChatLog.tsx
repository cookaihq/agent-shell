import { useRef, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Block, MessageDTO } from '../api/types'
import type { Engine } from '@agent-shell/contracts'
import type { RunStatus, ProgressActivity } from './chatReducer'
import { DiffModal, type DiffPayload } from './blocks/DiffModal'
import { RawModal } from './blocks/RawModal'
import { WorkStatus } from './WorkStatus'
import { getSlice } from './agents/registry'
import { renderTimeline, buildResultMap, buildChildrenMap, type SaCtx, type OpenCommand } from './timeline'
import { useSettings } from '../settings/SettingsContext'
import { IconStop, IconPlay } from '../ui/icons'

// OpenCommand 定义在中立 timeline 骨架（共享渲染模块）；此处再导出，兼容既有 import 路径（FileWorkspace/CommandPreview/Workspace）。
export type { OpenCommand }

interface ChatLogProps {
  messages: MessageDTO[]
  liveBlocks: Block[] | null
  /** 切片私有累计态（chatReducer.sliceState，外壳不解释）：透传给切片 timelineMount 渲染 subagent 节点（spec §6）。 */
  sliceState?: unknown
  runStatus: RunStatus
  failReason?: string
  /** 运行中的实时进度（驱动底部 WorkStatus 状态行）；turn_end 后由 reducer 清空 → 本行消失。
   *  activity 可缺省（回答提问/授权后过渡态）→ WorkStatus 显示「处理中…」。 */
  liveProgress?: { tokens: number; activity?: ProgressActivity }
  /** 当前会话引擎（用于从切片取 activityLabel 翻译器，驱动 WorkStatus 文案）。缺省 'claude'。 */
  engine?: Engine
  onResume: () => void
  /** 点击运行命令卡 → 右侧开命令 tab。 */
  onOpenCommand?: (cmd: OpenCommand) => void
  /** 点击用户附件 chip → 右侧预览文件（path 为项目内相对路径）。 */
  onOpenFile?: (path: string) => void
  /** 当前项目根绝对路径（读取/编辑卡路径精简用，Issue 9）。 */
  projectRoot?: string
  /** 当前项目 id（附件内嵌图片走 rawUrl 取流用，Issue 26）。 */
  projectId?: string
  /** 当前会话 id（调试模式点 🐞 取原始记录用）。 */
  sessionId?: string
}

/** 把扁平消息按「用户消息开启新一轮」分组：每轮 = 一条 user + 其后到下一条 user 之前的所有 assistant。
 *  支撑「每轮用户消息 sticky 贴顶接力」：sticky 的 .msg.user 受 .chat-turn 约束，本轮滚走时被容器底边顶出消失，
 *  下一轮接力（同一时刻只钉一条），而非扁平兄弟那样多条 user 永久钉在 top:0 叠在一起。 */
function groupTurns(msgs: MessageDTO[]): { key: string; messages: MessageDTO[] }[] {
  const turns: { key: string; messages: MessageDTO[] }[] = []
  for (const m of msgs) {
    if (m.role === 'user' || turns.length === 0) turns.push({ key: m.id, messages: [m] })
    else turns[turns.length - 1].messages.push(m)
  }
  return turns
}

interface BlocksViewProps {
  blocks: Block[]
  engine: Engine
  sliceState: unknown
  onOpenCommand?: (cmd: OpenCommand) => void
  onOpenDiff?: (d: DiffPayload) => void
  projectRoot?: string
}

function BlocksView({ blocks, engine, sliceState, onOpenCommand, onOpenDiff, projectRoot }: BlocksViewProps) {
  // 接缝（spec §6）：Task 块委托当前会话引擎切片 timelineMount 渲染（codex 无 → Task 块不特殊渲染）。
  const ctx: SaCtx = { resultMap: buildResultMap(blocks), childrenOf: buildChildrenMap(blocks), sliceState, mountTask: getSlice(engine).timelineMount, onOpenCommand, onOpenDiff, projectRoot }
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

/** 轮终结状态条（失败/中止）：内联渲染那一轮的 run_note 历史块。
 *  showResume = 仅当它是最新一轮的终态块时挂「继续」按钮（历史中间的旧失败块只留痕、不可点继续）。 */
function RunNote({ note, showResume, onResume }: {
  note: Extract<Block, { type: 'run_note' }>
  showResume: boolean
  onResume: () => void
}) {
  const text =
    note.stopReason === 'aborted'
      ? '已中止当前任务 · 已完成的内容已保留'
      : note.detail
        ? `任务失败 · ${note.detail}`
        : '任务失败'
  return (
    <div className="run-note">
      <span className="rn-ic"><IconStop size={13} /></span>
      <span className="rn-txt">{text}</span>
      {showResume && (
        <button className="rn-resume" type="button" onClick={onResume}>
          <IconPlay size={12} />
          继续
        </button>
      )}
    </div>
  )
}

interface MessageViewProps {
  message: MessageDTO
  engine: Engine
  sliceState: unknown
  onOpenCommand?: (cmd: OpenCommand) => void
  onOpenDiff?: (d: DiffPayload) => void
  onOpenFile?: (path: string) => void
  projectRoot?: string
  projectId?: string
  sessionId?: string
  /** 该消息是否为整段对话最后一条 + 当前会话是否停在失败/中止终态 → 决定末尾 run_note 块是否挂「继续」按钮。 */
  isLast?: boolean
  runStatus?: RunStatus
  onResume?: () => void
}

function MessageView({ message, engine, sliceState, onOpenCommand, onOpenDiff, onOpenFile, projectRoot, projectId, sessionId, isLast, runStatus, onResume }: MessageViewProps) {
  const { debugMode } = useSettings()
  const [rawOpen, setRawOpen] = useState<unknown | null>(null)

  if (message.role === 'user') {
    const text = message.blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    const files = message.blocks
      .filter((b) => b.type === 'attachments')
      .flatMap((b) => (b as { type: 'attachments'; files: { name: string; path: string }[] }).files)
    return (
      <div className="msg user">
        {files.length > 0 && (
          <div className="user-attach">
            {files.map((f, i) => (
              <span
                key={i}
                className="ua-chip"
                title="点击在右侧预览"
                onClick={() => onOpenFile?.(f.path)}
              >
                {isImagePath(f.path) && projectId
                  ? <span className="ua-thumb" style={{ backgroundImage: `url(${api.rawUrl(projectId, f.path)})` }} />
                  : <span className="ua-ic">{(f.name.split('.').pop() || '·').slice(0, 3).toUpperCase()}</span>}
                {f.name}
              </span>
            ))}
          </div>
        )}
        {text && <div className="user-text">{text}</div>}
      </div>
    )
  }

  // assistant：无角色头；debug 🐞 移为右上角标（hover 显形）
  // run_note 块（轮终结状态条）从正文块里分离：正文走时间线渲染，run_note 内联在末尾（含可选「继续」按钮）。
  const runNote = message.blocks.find((b) => b.type === 'run_note') as Extract<Block, { type: 'run_note' }> | undefined
  const bodyBlocks = runNote ? message.blocks.filter((b) => b.type !== 'run_note') : message.blocks
  return (
    <div className="msg assistant">
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
      <BlocksView blocks={bodyBlocks} engine={engine} sliceState={sliceState} onOpenCommand={onOpenCommand} onOpenDiff={onOpenDiff} projectRoot={projectRoot} />
      {runNote && <RunNote note={runNote} showResume={!!isLast && (runStatus === 'failed' || runStatus === 'aborted')} onResume={onResume ?? (() => {})} />}
      {rawOpen != null && <RawModal json={rawOpen} onClose={() => setRawOpen(null)} />}
    </div>
  )
}

export function ChatLog({ messages, liveBlocks, sliceState, runStatus, liveProgress, engine = 'claude', onResume, onOpenCommand, onOpenFile, projectRoot, projectId, sessionId }: ChatLogProps) {
  // 编辑卡完整 diff 浮层（Issue 21）：点编辑卡在左侧会话区浮出
  const [diffModal, setDiffModal] = useState<DiffPayload | null>(null)

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
  // 整段对话的最后一条消息 id：唯有它的末尾 run_note 块（=最新一轮终态）才挂「继续」按钮。
  const lastMsgId = allMessages.length > 0 ? allMessages[allMessages.length - 1].id : undefined

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
  }, [messages, liveBlocks, liveProgress, runStatus])

  return (
    <>
      <div className="chat-log" ref={scrollRef} onScroll={handleScroll}>
        {groupTurns(allMessages).map((turn) => (
          <div className="chat-turn" key={turn.key}>
            {turn.messages.map((msg) => (
              <MessageView key={msg.id} message={msg} engine={engine} sliceState={sliceState} onOpenCommand={onOpenCommand} onOpenDiff={setDiffModal} onOpenFile={onOpenFile} projectRoot={projectRoot} projectId={projectId} sessionId={sessionId} isLast={msg.id === lastMsgId} runStatus={runStatus} onResume={onResume} />
            ))}
          </div>
        ))}
        {runStatus === 'running' && liveProgress && (
          <WorkStatus tokens={liveProgress.tokens} label={liveProgress.activity ? getSlice(engine).activityLabel?.(liveProgress.activity) : undefined} />
        )}
        {runStatus === 'running' && !liveProgress && (!liveBlocks || liveBlocks.length === 0) && (
          <WorkStatus />
        )}
        {/* 失败/中止的状态条已下沉为那一轮 assistant 消息里的内联 run_note 块（见 MessageView），
            随历史落库、重载留痕、下一轮不清空；底部不再独立渲染（避免与内联块重复）。 */}
      </div>
      {/* 完整 diff 浮层（Issue 21）：覆盖左侧会话区，不随消息滚动 */}
      {diffModal && <DiffModal payload={diffModal} onClose={() => setDiffModal(null)} />}
    </>
  )
}
