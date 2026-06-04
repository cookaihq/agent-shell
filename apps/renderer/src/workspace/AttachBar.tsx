/**
 * AttachBar.tsx — 消息附件预览栏
 *
 * 统一显示「图标 + 名」（去掉缩略图，对齐 V1 减法 + open-design）；文件夹用文件夹图标。
 * 承载首页/工作区两种暂存项的展示，数据形态各自维护，这里只要 {name, kind}。
 *
 * 结构（对齐原型）：.attach-bar > .attach-chip* > .ac-ic + .ac-name + .ac-x
 */

/** 一个附件 chip 的显示数据。 */
export interface AttachChip { name: string; kind: 'file' | 'dir' }

const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
)
const DirIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

interface AttachBarProps {
  attachments: AttachChip[]
  onRemove: (idx: number) => void
}

export function AttachBar({ attachments, onRemove }: AttachBarProps) {
  if (attachments.length === 0) return <div className="attach-bar" />
  return (
    <div className="attach-bar">
      {attachments.map((a, i) => (
        <span key={i} className="attach-chip">
          <span className="ac-ic">{a.kind === 'dir' ? <DirIcon /> : <FileIcon />}</span>
          <span className="ac-name">{a.name}</span>
          <button className="ac-x" title="移除" type="button" onClick={() => onRemove(i)}>×</button>
        </span>
      ))}
    </div>
  )
}
