/**
 * Preview.tsx — 预览渲染重构（Issue 3 + 4 + 22）
 *
 * 按文件类型分流到不同呈现：
 *   - 图片（png/jpg/webp/gif/svg/…）→ <img src=rawUrl>
 *   - PDF → <iframe src=rawUrl>（Chromium 内置 PDF 查看器）
 *   - Markdown（md/markdown）→ 复用 runtime/markdown（相对图片重写为 rawUrl）
 *   - HTML（html/htm）→ <iframe src=rawUrl>（真实同源 URL，相对资源正常 + 页内可跳转）+ 自动适配宽度
 *   - 文本/代码 → <pre>
 *
 * 二进制/HTML 字节走 daemon 的 /api/pf/:id/<path> 路由（同源、cookie 过门、相对子资源自动解析）。
 * Issue 3 全宽：HTML 改用 iframe src 全宽，不再 srcDoc 内联 + intrinsic-width 缩放。
 * HTML 自动适配宽度：iframe 同源（renderer 与 daemon 同 origin），加载后读 contentDocument 量出内容自然宽度；
 *   若比面板宽（固定宽稿子，如 PPT），设 iframe 显式 width=自然宽 + CSS zoom=面板宽/自然宽——
 *   实测（headless Chrome）：zoom 让内部视口=显式 width（内容铺满、无内部横条）、布局盒=width×zoom（面板不溢出、无外部横条）。
 *   响应式页面（内容不溢出）保持 width:100% 1:1。手动缩放按钮在此基础上叠乘（zoom 控件）。
 * Issue 22：工具栏地址栏，输入 URL（如 agent 起的本地服务 http://127.0.0.1:8753）回车 → 同一面板进「浏览器模式」。
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { renderMarkdown } from '../runtime/markdown'

// ── 缩放参数（预览专属，不影响整个应用页面）──────────────────────────────────
const ZOOM_STEP = 0.1
const ZOOM_MIN = 0.25
const ZOOM_MAX = 5
const clampZoom = (z: number) =>
  Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.round(z * 100) / 100))

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

const MinusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
    <path d="M5 12h14" />
  </svg>
)

const PlusIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24"
    fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round">
    <path d="M12 5v14M5 12h14" />
  </svg>
)

// ── 文件类型分流 ───────────────────────────────────────────────────────────────
type PreviewKind = 'image' | 'pdf' | 'html' | 'markdown' | 'text'

const IMAGE_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico', 'avif'])

function kindOfFile(path: string): PreviewKind {
  const ext = path.toLowerCase().split('.').pop() ?? ''
  if (IMAGE_EXT.has(ext)) return 'image'
  if (ext === 'pdf') return 'pdf'
  if (ext === 'html' || ext === 'htm') return 'html'
  if (ext === 'md' || ext === 'markdown') return 'markdown'
  return 'text'
}

// Markdown 内的相对图片路径 → daemon raw URL（解析 ./ 与 ../，相对 md 文件所在目录）。
// 协议/绝对/锚点（http: data: blob: / #）保持原样。
function rewriteMdImages(md: string, projectId: string, mdRelPath: string): string {
  const slash = mdRelPath.lastIndexOf('/')
  const dir = slash >= 0 ? mdRelPath.slice(0, slash) : ''
  return md.replace(/(!\[[^\]]*\]\()([^)\s]+)(\))/g, (full, pre: string, src: string, post: string) => {
    if (/^([a-z][a-z0-9+.-]*:|\/\/|\/|#)/i.test(src)) return full
    const parts: string[] = []
    for (const seg of `${dir ? dir + '/' : ''}${src}`.split('/')) {
      if (seg === '' || seg === '.') continue
      if (seg === '..') { parts.pop(); continue }
      parts.push(seg)
    }
    return `${pre}${api.rawUrl(projectId, parts.join('/'))}${post}`
  })
}

// 把地址栏输入规整成可加载 URL（裸 host:port 默认补 http://）。
function normalizeUrl(input: string): string {
  const s = input.trim()
  if (!s) return ''
  if (/^https?:\/\//i.test(s)) return s
  return `http://${s}`
}

// ── Preview 组件 ──────────────────────────────────────────────────────────────

interface TextContent {
  content: string
  truncated: boolean
}

interface PreviewProps {
  projectId: string
  activeFile: string | null
}

export function Preview({ projectId, activeFile }: PreviewProps) {
  // 文本/markdown 内容（图片/PDF/HTML 走 rawUrl，不在此加载）
  const [textData, setTextData] = useState<TextContent | null>(null)
  const [loading, setLoading] = useState(false)
  const [loadFailed, setLoadFailed] = useState(false)
  // 用户缩放（图片/HTML/浏览器模式；PDF 用 Chromium 自带缩放）
  const [zoom, setZoom] = useState(1)
  // 浏览器模式（Issue 22）：非空 = 地址栏输入的 URL，覆盖文件预览
  const [browserUrl, setBrowserUrl] = useState<string | null>(null)
  // 地址栏输入值
  const [addr, setAddr] = useState('')
  // 刷新计数：变化即强制 <img>/<iframe> 重载
  const [reloadKey, setReloadKey] = useState(0)
  // 「在外部打开」失败信息（仅作 tooltip 提示）
  const [openErr, setOpenErr] = useState<string | null>(null)

  // HTML 自动适配宽度（同源测量）：
  //  - htmlScrollRef：外层滚动容器（reserve 了滚动条 gutter，clientWidth=真实可用宽）；htmlIframeRef：被缩放的 iframe
  //  - naturalRef：内容自然尺寸（仅当内容比可用宽还宽时记录，null=响应式/已铺满，走 1:1）
  //  - htmlEffScale：当前 HTML 的有效缩放（=适配基准×手动 zoom），仅供工具栏 % 展示
  const htmlScrollRef = useRef<HTMLDivElement | null>(null)
  const htmlIframeRef = useRef<HTMLIFrameElement | null>(null)
  const naturalRef = useRef<{ w: number; h: number } | null>(null)
  const [htmlEffScale, setHtmlEffScale] = useState(1)

  const kind = activeFile ? kindOfFile(activeFile) : 'text'

  // 用系统默认程序打开当前文件（HTML→浏览器、代码→默认编辑器）。
  const openExternal = useCallback(async () => {
    if (!activeFile) return
    setOpenErr(null)
    try {
      const { absPath } = await api.absPath(projectId, activeFile)
      const bridge = window.agentShell
      if (!bridge) { setOpenErr('仅桌面版支持在外部打开'); return }
      const r = await bridge.openPath(absPath)
      if (!r.ok) setOpenErr(r.error || '打开失败')
    } catch {
      setOpenErr('打开失败')
    }
  }, [projectId, activeFile])

  const applyZoom = useCallback((intent: 'in' | 'out' | 'reset') => {
    if (intent === 'reset') setZoom(1)
    else if (intent === 'in') setZoom(z => clampZoom(z + ZOOM_STEP))
    else setZoom(z => clampZoom(z - ZOOM_STEP))
  }, [])

  // 同源读取 iframe 文档（跨源/未就绪 → null）
  const htmlDoc = (): Document | null => {
    try { return htmlIframeRef.current?.contentDocument ?? null } catch { return null }
  }

  // 量内容自然宽度（须在 iframe 处于 width:100% 基线时调用）：
  // 比可用宽还宽 → 记自然尺寸（固定宽稿子）；否则 null（响应式/已铺满，走 1:1）。
  // 可用宽 = 滚动容器 clientWidth（已扣除 scrollbar-gutter 预留宽，故是真实可放下的宽度）。
  const measureNatural = useCallback(() => {
    const doc = htmlDoc()
    const sc = htmlScrollRef.current
    if (!doc?.documentElement || !sc) { naturalRef.current = null; return }
    const W = sc.clientWidth
    const root = doc.documentElement
    const cw = Math.max(root.scrollWidth, doc.body?.scrollWidth ?? 0)
    const ch = Math.max(root.scrollHeight, doc.body?.scrollHeight ?? 0)
    naturalRef.current = cw > W + 1 ? { w: cw, h: ch } : null
  }, [])

  // 应用适配（实测验证的配方，见文件头注释）：
  //  - 固定宽稿子：内层 overflow:hidden（裁掉缩放产生的亚像素溢出，杜绝内部滚动条吃宽度）
  //    + iframe 显式 width=自然宽、height=自然高 + CSS zoom=可用宽/自然宽（×手动 zoom）。
  //    zoom 缩布局盒到可用宽 → 外层不出横条；内层视口=自然宽 → 内容铺满无横条；竖向超出由外层滚动。
  //  - 响应式：还原内层默认滚动 + iframe width/height:100%、仅叠手动 zoom。
  // zoom 用 setProperty（非标准属性，TS 无声明）。
  const applyHtmlFit = useCallback(() => {
    const f = htmlIframeRef.current
    const sc = htmlScrollRef.current
    const doc = htmlDoc()
    if (!f || !sc || !doc?.documentElement) return
    const nat = naturalRef.current
    if (nat && nat.w > 0) {
      doc.documentElement.style.overflow = 'hidden'
      const base = Math.min(1, sc.clientWidth / nat.w)
      const eff = base * zoom
      f.style.width = `${nat.w}px`
      // 设宽后按自然宽重测高度（内容在自然宽下重排，高度更准）
      const h = Math.max(doc.documentElement.scrollHeight, doc.body?.scrollHeight ?? 0) || nat.h
      f.style.height = `${h}px`
      f.style.setProperty('zoom', String(eff))
      setHtmlEffScale(eff)
    } else {
      doc.documentElement.style.overflow = ''
      f.style.width = '100%'
      f.style.height = '100%'
      f.style.setProperty('zoom', String(zoom))
      setHtmlEffScale(zoom)
    }
  }, [zoom])

  // iframe 加载完成：重置 → 在 100% 基线测自然宽 → 适配
  const onHtmlLoad = useCallback(() => {
    naturalRef.current = null
    measureNatural()
    applyHtmlFit()
  }, [measureNatural, applyHtmlFit])

  // 换文件：退出浏览器模式、回到适应、清错误，按需拉取文本
  useEffect(() => {
    setBrowserUrl(null)
    setZoom(1)
    setOpenErr(null)
    setLoadFailed(false)
    setAddr('')
    naturalRef.current = null
    setHtmlEffScale(1)
    if (!activeFile) { setTextData(null); return }
    const k = kindOfFile(activeFile)
    if (k !== 'markdown' && k !== 'text') { setTextData(null); return }
    setLoading(true)
    let off = false
    api.file(projectId, activeFile)
      .then(data => { if (off) return; setTextData({ content: data.content, truncated: data.truncated }); setLoading(false) })
      .catch(() => { if (off) return; setLoadFailed(true); setLoading(false) })
    return () => { off = true }
  }, [projectId, activeFile, reloadKey])

  // 捕获 Cmd/Ctrl +/-/0 —— 只缩放预览，不缩放整页
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if ((!e.metaKey && !e.ctrlKey) || e.altKey) return
      if (e.key === '=' || e.key === '+') { e.preventDefault(); applyZoom('in') }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); applyZoom('out') }
      else if (e.key === '0') { e.preventDefault(); applyZoom('reset') }
    }
    window.addEventListener('keydown', onKeyDown, { capture: true })
    return () => window.removeEventListener('keydown', onKeyDown, { capture: true })
  }, [applyZoom])

  // HTML：手动 zoom 变化时重算适配（叠乘在适配基准上）
  useEffect(() => {
    if (kind === 'html') applyHtmlFit()
  }, [kind, applyHtmlFit])

  // HTML：面板尺寸变化时重算适配。响应式页面（未进适配）在新宽度下重测，
  // 以便缩窄到内容最小宽时也能转入适配；已适配则仅按新可用宽重算缩放（自然宽不变）。
  useEffect(() => {
    if (kind !== 'html') return
    const sc = htmlScrollRef.current
    if (!sc || typeof ResizeObserver === 'undefined') return
    let raf = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        if (!naturalRef.current) measureNatural()
        applyHtmlFit()
      })
    })
    ro.observe(sc)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [kind, measureNatural, applyHtmlFit])

  const submitAddr = (e: React.FormEvent) => {
    e.preventDefault()
    const url = normalizeUrl(addr)
    if (url) { setBrowserUrl(url); setZoom(1) }
  }

  const refresh = () => {
    if (browserUrl) setReloadKey(k => k + 1)
    else setReloadKey(k => k + 1)
  }

  // 是否显示缩放控件（图片/HTML/浏览器模式有意义；PDF 用内置查看器缩放）
  const showZoom = browserUrl !== null || kind === 'image' || kind === 'html'
  // HTML（文件预览，非浏览器模式）展示有效缩放（含自动适配）；其余展示手动 zoom
  const displayZoom = kind === 'html' && browserUrl === null ? htmlEffScale : zoom

  const rawUrl = activeFile ? api.rawUrl(projectId, activeFile) : ''
  // iframe 类内容（html/pdf/浏览器模式）铺满面板、无内边距居中（Issue 3 全宽）；其余（图片/文本/md）维持居中/滚动
  const fill = browserUrl !== null || kind === 'pdf' || kind === 'html'

  return (
    <div className="preview-wrap">
      <div className="preview-toolbar">
        <button className="chat-hicon" title="刷新" type="button" onClick={refresh}>
          <RefreshIcon />
        </button>
        {/* 地址栏（Issue 22）：输 URL 回车进浏览器模式 */}
        <form className="preview-addr" onSubmit={submitAddr}>
          <input
            className="preview-addr-input"
            type="text"
            value={addr}
            placeholder={browserUrl ?? '输入 URL（如 http://127.0.0.1:8753）回车在此打开'}
            spellCheck={false}
            onChange={(e) => setAddr(e.target.value)}
          />
        </form>
        {browserUrl && (
          <button className="chat-hicon" type="button" title="关闭浏览器，返回文件预览" onClick={() => { setBrowserUrl(null); setAddr('') }}>
            ✕
          </button>
        )}
        {!browserUrl && activeFile && (
          <span className="preview-fname" title={activeFile}>{activeFile.split('/').pop()}</span>
        )}
        {showZoom && (
          <div className="preview-zoom-ctrl">
            <button className="pz-btn" type="button" title="缩小（Cmd/Ctrl -）"
              onClick={() => applyZoom('out')} disabled={zoom <= ZOOM_MIN}>
              <MinusIcon />
            </button>
            <button className="pz-val" type="button"
              title={kind === 'html' && !browserUrl ? '重置为适应宽度（Cmd/Ctrl 0）' : '重置（Cmd/Ctrl 0）'}
              onClick={() => applyZoom('reset')}>
              {Math.round(displayZoom * 100)}%
            </button>
            <button className="pz-btn" type="button" title="放大（Cmd/Ctrl +）"
              onClick={() => applyZoom('in')} disabled={zoom >= ZOOM_MAX}>
              <PlusIcon />
            </button>
          </div>
        )}
        <button className="chat-hicon" type="button"
          title={openErr ?? '用系统默认程序打开'}
          onClick={openExternal} disabled={!activeFile}>
          <OpenExternalIcon />
        </button>
      </div>

      <div className={`preview-stage${fill ? ' is-fill' : ''}`}>
        {/* 浏览器模式（Issue 22）优先 */}
        {browserUrl ? (
          <iframe
            key={`browser-${reloadKey}`}
            className="preview-iframe"
            src={browserUrl}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            style={{ zoom }}
            title={browserUrl}
          />
        ) : !activeFile ? (
          <div className="preview-empty">从左侧打开一个文件预览，或在地址栏输入 URL</div>
        ) : loading ? (
          <div className="preview-loading">加载中…</div>
        ) : kind === 'image' ? (
          <div className="preview-media">
            <img
              key={`img-${reloadKey}`}
              className="preview-img"
              src={rawUrl}
              alt={activeFile}
              style={{ zoom }}
              onError={() => setLoadFailed(true)}
            />
            {loadFailed && <div className="preview-empty">无法加载图片</div>}
          </div>
        ) : kind === 'pdf' ? (
          <iframe
            key={`pdf-${reloadKey}`}
            className="preview-iframe"
            src={rawUrl}
            title={activeFile}
          />
        ) : kind === 'html' ? (
          // 自动适配宽度：iframe 的 width/height/zoom + 内层 overflow 由 applyHtmlFit 在加载后命令式设置，
          // 故此处不传 style（避免 React 重渲覆盖）。外层 scroll 容器仅在放大超出面板时出滚动条。
          <div ref={htmlScrollRef} className="preview-html-scroll">
            <iframe
              key={`html-${reloadKey}`}
              ref={htmlIframeRef}
              className="preview-iframe"
              src={rawUrl}
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
              onLoad={onHtmlLoad}
              title={activeFile}
            />
          </div>
        ) : kind === 'markdown' && textData ? (
          <div className="preview-md prose" style={{ zoom }}>
            {renderMarkdown(rewriteMdImages(textData.content, projectId, activeFile))}
            {textData.truncated && <div className="preview-truncated">已截断（文件过大，仅显示部分内容）</div>}
          </div>
        ) : textData ? (
          <>
            <pre className="code-view">{textData.content}</pre>
            {textData.truncated && <div className="preview-truncated">已截断（文件过大，仅显示部分内容）</div>}
          </>
        ) : loadFailed ? (
          <div className="preview-empty">无法加载文件</div>
        ) : null}
      </div>
    </div>
  )
}
