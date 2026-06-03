import type { Block, MessageDTO, Engine } from '../api/types'
import type { RunStatus } from './chatReducer'
import { OpCard, kindOf } from './blocks/OpCard'
import { TodoCard } from './blocks/TodoCard'
import { Thinking } from './blocks/Thinking'
import { AGENT_LABEL } from './runtimeState'
import { IconStop, IconPlay } from '../ui/icons'

interface ChatLogProps {
  messages: MessageDTO[]
  liveBlocks: Block[] | null
  runStatus: RunStatus
  failReason?: string
  onResume: () => void
  engine?: Engine
}

// 把毫秒时间戳格式化为本地 HH:mm（两位补零）
function formatTime(createdAt: number): string {
  const d = new Date(createdAt)
  const hh = String(d.getHours()).padStart(2, '0')
  const mm = String(d.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

// Build a map from toolUseId → tool_result block for pairing
function buildResultMap(blocks: Block[]): Map<string, { ok: boolean; content: string }> {
  const map = new Map<string, { ok: boolean; content: string }>()
  for (const b of blocks) {
    if (b.type === 'tool_result') {
      map.set(b.toolUseId, { ok: b.ok, content: b.content })
    }
  }
  return map
}

interface BlocksViewProps {
  blocks: Block[]
}

function BlocksView({ blocks }: BlocksViewProps) {
  const resultMap = buildResultMap(blocks)

  return (
    <>
      {blocks.map((block, i) => {
        if (block.type === 'text') {
          return (
            <div key={i} className="prose">
              <p>{block.text}</p>
            </div>
          )
        }

        if (block.type === 'thinking') {
          return <Thinking key={i} text={block.text} />
        }

        if (block.type === 'tool_use') {
          const kind = kindOf(block.name)
          const result = resultMap.get(block.id)

          if (kind === 'todo') {
            const inp = block.input as { todos?: Array<{ content: string; status: string }> }
            const todos = inp.todos ?? []
            return <TodoCard key={i} todos={todos} />
          }

          return (
            <OpCard
              key={i}
              name={block.name}
              input={block.input}
              result={result ?? null}
            />
          )
        }

        // tool_result: skip (rendered via paired tool_use)
        return null
      })}
    </>
  )
}

interface MessageViewProps {
  message: MessageDTO
  engine: Engine
}

function MessageView({ message, engine }: MessageViewProps) {
  const time = formatTime(message.createdAt)

  if (message.role === 'user') {
    const text = message.blocks
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    return (
      <div className="msg user">
        <div className="role">你 <span className="rt">{time}</span></div>
        <div className="user-text">{text}</div>
      </div>
    )
  }

  // assistant
  return (
    <div className="msg assistant">
      <div className="role">{AGENT_LABEL[engine]} <span className="rt">{time}</span></div>
      <BlocksView blocks={message.blocks} />
    </div>
  )
}

export function ChatLog({ messages, liveBlocks, runStatus, failReason, onResume, engine = 'claude' }: ChatLogProps) {
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

  return (
    <div className="chat-log">
      {allMessages.map((msg) => (
        <MessageView key={msg.id} message={msg} engine={engine} />
      ))}
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
  )
}
