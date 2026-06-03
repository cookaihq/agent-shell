/**
 * AttachBar.tsx — Task 18
 *
 * 附件预览栏。移植 app.js 附件 (L637-658)。
 * 前端态，不上传；submit 不带附件。上传/组装=后续子里程碑。
 *
 * 结构（对齐原型）：
 *   .attach-bar > .attach-chip* > .ac-thumb(图片) | .ac-ic(文件图标) + .ac-name + .ac-x
 */
import type { AttachedFile } from './Composer'

// 文件图标 SVG（来自 app.js L643）
const FileIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
    <path d="M14 2v6h6" />
  </svg>
)

interface AttachBarProps {
  attachments: AttachedFile[]
  onRemove: (idx: number) => void
}

export function AttachBar({ attachments, onRemove }: AttachBarProps) {
  return (
    <div className="attach-bar">
      {attachments.map((a, i) => (
        <span key={i} className="attach-chip">
          {a.isImage ? (
            <img className="ac-thumb" src={a.objectUrl} alt="" />
          ) : (
            <span className="ac-ic">
              <FileIcon />
            </span>
          )}
          <span className="ac-name">{a.file.name || '粘贴图片.png'}</span>
          <button
            className="ac-x"
            title="移除"
            type="button"
            onClick={() => onRemove(i)}
          >
            ×
          </button>
        </span>
      ))}
    </div>
  )
}
