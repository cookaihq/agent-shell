/**
 * Preview.tsx — Task 20
 *
 * 文件预览面板。
 * 高保真对照原型 workspace.html L155-163 + app.js file workspace render 逻辑。
 *
 * 结构：
 *   .preview-wrap
 *     > .preview-toolbar（刷新 / url / 在编辑器打开，按钮可占位）
 *     > .preview-stage（内容区）
 *         - .html/.htm → <iframe srcdoc sandbox>
 *         - 其它 → <pre className="code-view">
 *
 * activeFile 变化 → api.file(projectId, path) 拉内容。
 * truncated=true → 内容末尾显示「已截断」提示。
 */

import { useEffect, useState } from 'react'
import { api } from '../api/client'

// ── SVG 图标 ──────────────────────────────────────────────────────────────────

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2}>
    <path d="M21 12a9 9 0 1 1-3-6.7" strokeLinecap="round" />
    <path d="M21 4v5h-5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

const OpenExternalIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2}
    strokeLinejoin="round">
    <path d="M14 3h7v7M21 3l-9 9" />
    <path d="M5 7v12h12" />
  </svg>
)

// ── 判断是否 HTML（走 iframe）─────────────────────────────────────────────────
function isHtml(path: string): boolean {
  const lower = path.toLowerCase()
  return lower.endsWith('.html') || lower.endsWith('.htm')
}

// ── Preview 组件 ──────────────────────────────────────────────────────────────

interface FileContent {
  path: string
  content: string
  truncated: boolean
}

interface PreviewProps {
  projectId: string
  activeFile: string | null
}

export function Preview({ projectId, activeFile }: PreviewProps) {
  const [fileData, setFileData] = useState<FileContent | null>(null)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!activeFile) {
      setFileData(null)
      return
    }
    setLoading(true)
    api.file(projectId, activeFile)
      .then(data => {
        setFileData(data)
        setLoading(false)
      })
      .catch(() => {
        setLoading(false)
      })
  }, [projectId, activeFile])

  return (
    <div className="preview-wrap">
      <div className="preview-toolbar">
        <button className="chat-hicon" title="刷新" type="button">
          <RefreshIcon />
        </button>
        <span>预览</span>
        {activeFile && (
          <span className="url">{activeFile}</span>
        )}
        <button className="chat-hicon" title="在编辑器中打开" type="button">
          <OpenExternalIcon />
        </button>
      </div>
      <div className="preview-stage">
        {loading && <div className="preview-loading">加载中…</div>}
        {!loading && fileData && (
          <>
            {isHtml(fileData.path) ? (
              <iframe
                srcDoc={fileData.content}
                sandbox="allow-scripts"
                style={{ width: '100%', height: '100%', border: 'none' }}
                title={fileData.path}
              />
            ) : (
              <pre className="code-view">{fileData.content}</pre>
            )}
            {fileData.truncated && (
              <div className="preview-truncated">已截断（文件过大，仅显示部分内容）</div>
            )}
          </>
        )}
        {!loading && !fileData && activeFile && (
          <div className="preview-empty">无法加载文件</div>
        )}
      </div>
    </div>
  )
}
