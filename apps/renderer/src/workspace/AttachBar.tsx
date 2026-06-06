/**
 * AttachBar.tsx — 消息附件预览栏
 *
 * 文件/文件夹：图标 + 名（沿用 V1 减法 + open-design）。
 * 图片（chip 带 previewUrl）：渲染真实缩略图（.ac-thumb），点击弹大图 lightbox 浮层
 *   —— 对齐 VS Code Claude 插件 / open-design staged-preview-modal（[同步自 open-design]）。
 * 承载首页/工作区两种暂存项的展示，数据形态各自维护，这里只要 {name, kind, previewUrl?}。
 *
 * 结构（对齐原型）：.attach-bar > .attach-chip* > (.ac-ic|.ac-view>.ac-thumb) + .ac-name + .ac-x
 */

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { IconClose } from '../ui/icons'

/** 一个附件 chip 的显示数据。previewUrl 有值 = 图片，渲染缩略图 + 点击放大。 */
export interface AttachChip { name: string; kind: 'file' | 'dir'; previewUrl?: string }

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
  // 大图浮层：点缩略图打开，Esc / 点背景关闭（参考 open-design staged-preview-modal）
  const [preview, setPreview] = useState<{ url: string; name: string } | null>(null)
  useEffect(() => {
    if (!preview) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPreview(null) }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [preview])

  if (attachments.length === 0) return <div className="attach-bar" />
  return (
    <div className="attach-bar">
      {attachments.map((a, i) => (
        <span key={i} className="attach-chip">
          {a.previewUrl ? (
            <button
              className="ac-view"
              type="button"
              title="点击查看大图"
              onClick={() => setPreview({ url: a.previewUrl!, name: a.name })}
            >
              <img className="ac-thumb" src={a.previewUrl} alt="" />
              <span className="ac-name">{a.name}</span>
            </button>
          ) : (
            <>
              <span className="ac-ic">{a.kind === 'dir' ? <DirIcon /> : <FileIcon />}</span>
              <span className="ac-name">{a.name}</span>
            </>
          )}
          <button className="ac-x" title="移除" type="button" onClick={() => onRemove(i)}>×</button>
        </span>
      ))}

      {preview && createPortal(
        <div
          className="ac-lightbox"
          role="dialog"
          aria-modal="true"
          aria-label={preview.name}
          onMouseDown={(e) => { if (e.target === e.currentTarget) setPreview(null) }}
        >
          <div className="acl-card">
            <div className="acl-head">
              <span title={preview.name}>{preview.name}</span>
              <button className="acl-close" type="button" title="关闭" onClick={() => setPreview(null)}>
                <IconClose size={16} />
              </button>
            </div>
            <img className="acl-img" src={preview.url} alt={preview.name} />
          </div>
        </div>,
        document.body,
      )}
    </div>
  )
}
