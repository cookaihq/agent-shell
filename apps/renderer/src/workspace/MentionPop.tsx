/**
 * MentionPop.tsx — Task 17
 *
 * @ / / 候选菜单渲染组件。
 * 高保真对照 app.js wireMention render() (L703-718) + workspace.html L66 .mention-pop。
 *
 * className 完全对齐原型：
 *   .mention-pop > [.mention-group-h] + .mention-item[.is-active]
 *     > .mention-ic + .mention-main > b + i?
 */
import type { MentionItem, IconKind } from './useMention'

// ── SVG 图标（对齐 app.js ICON L680-685）─────────────────────────────────────

const IC_PATH: Record<IconKind, string> = {
  folder: '<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>',
  file:   '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  skill:  '<path d="M12 3l1.8 4.6L18.7 9l-4.9 1.4L12 15l-1.8-4.6L5.3 9l4.9-1.4z"/>',
  cmd:    '<path d="M4 17l6-6-6-6"/><path d="M12 19h8"/>',
}

function MentionIcon({ kind }: { kind: IconKind }) {
  return (
    <svg
      width="15" height="15" viewBox="0 0 24 24"
      fill="none" stroke="currentColor"
      strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"
      dangerouslySetInnerHTML={{ __html: IC_PATH[kind] }}
    />
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface MentionPopProps {
  open: boolean
  items: MentionItem[]
  activeIndex: number
  /** mouseDown 时调用，传 item 索引；调用方负责 choose(ta, idx) */
  onChoose: (idx: number) => void
  /**
   * 斜杠命令面板顶部 sticky 搜索框：当前过滤词（不含前缀 /）。
   * 仅 is-cmd 态显示；只读镜像，不触发第二过滤源。
   */
  query?: string
  /**
   * 搜索框被点击/聚焦时把焦点送回 composer textarea（可选）。
   * V1 只读镜像：点击时 focus 回 composer，不让搜索框抢焦点。
   */
  onFocusComposer?: () => void
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MentionPop({ open, items, activeIndex, onChoose, query, onFocusComposer }: MentionPopProps) {
  // 渲染分组：同组仅第一次输出 group header
  const rows: JSX.Element[] = []
  let lastGroup: string | undefined = undefined

  items.forEach((item, i) => {
    if (item.group && item.group !== lastGroup) {
      rows.push(
        <div key={`g-${item.group}`} className="mention-group-h">
          {item.group}
        </div>
      )
      lastGroup = item.group
    }
    rows.push(
      <button
        key={item.insert}
        className={`mention-item${i === activeIndex ? ' is-active' : ''}`}
        data-mi={i}
        type="button"
        // mouseDown（在 blur 之前触发）防止 textarea 失焦
        onMouseDown={(e) => {
          e.preventDefault()
          onChoose(i)
        }}
      >
        <span className="mention-ic">
          <MentionIcon kind={item.icon} />
        </span>
        <span className="mention-main">
          <b>{item.label}</b>
          {item.desc && <i>{item.desc}</i>}
        </span>
      </button>
    )
  })

  const isCmd = items.length > 0 && items[0].icon === 'cmd'
  return (
    <div className={`mention-pop${isCmd ? ' is-cmd' : ''}`} hidden={!open}>
      {/* 斜杠命令面板顶部吸附搜索框（Task 6.6.2）：只读镜像 + 点击送焦点回 composer */}
      {isCmd && (
        <div className="mention-search-wrap">
          <input
            className="mention-search"
            type="text"
            value={query ?? ''}
            readOnly
            placeholder="搜索命令…"
            tabIndex={-1}
            onMouseDown={(e) => {
              // mouseDown 阶段 preventDefault 防止 textarea 失焦（与 mention-item 同款）
              e.preventDefault()
              onFocusComposer?.()
            }}
          />
        </div>
      )}
      {rows}
    </div>
  )
}
