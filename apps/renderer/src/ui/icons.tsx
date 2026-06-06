// Task 8/9/10 icons — SVG path data 1:1 from prototype app.js ICON/ENG/inline SVG
// Task 8 (Chrome, NewProjectModal), Task 9 (AppShell), Task 10 (ProjBar).
// Task 15 icons — IconSend (ICON_SEND L856), IconPaperclip (attachBtn SVG workspace.html L69)

interface SvgProps {
  size?: number
  className?: string
}

// ── Generic stroke icons (from prototype ICON object) ──────────────────────

// 返回箭头图标（path 1:1 来自 workspace.html proj-bar 返回 <a> 内联 SVG）
export const IconChevronLeft = ({ size = 16 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M15 18l-6-6 6-6" />
  </svg>
)

export const IconClose = ({ size = 18 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
)

// ── Engine pixel icon (from prototype ENG object) ──────────────────────────
// Renders the <span class="ag-ic"> wrapper + inner SVG, exactly as in app.js ENG.*

// Stop icon (from prototype app.js ICON_STOP)
export const IconStop = ({ size = 13 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" stroke="none">
    <rect x="6" y="6" width="12" height="12" rx="2.5" />
  </svg>
)

// Play icon (from prototype app.js ICON_PLAY)
export const IconPlay = ({ size = 12 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" stroke="none">
    <path d="M7 5v14l12-7z" />
  </svg>
)

// Send icon (from prototype app.js ICON_SEND L856)
export const IconSend = ({ size = 15 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 19V5M5 12l7-7 7 7" />
  </svg>
)

// Paperclip icon (from prototype workspace.html L69 attachBtn SVG)
export const IconPaperclip = ({ size = 15 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />
  </svg>
)

// ── Projects 工具栏 / 选择态 / 看板图标（path 1:1 来自原型 app.js projects IIFE） ──
export const IconSearch = ({ size = 13 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" />
  </svg>
)
export const IconGrid = ({ size = 14 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="4" y="4" width="7" height="7" rx="1" /><rect x="13" y="4" width="7" height="7" rx="1" /><rect x="4" y="13" width="7" height="7" rx="1" /><rect x="13" y="13" width="7" height="7" rx="1" />
  </svg>
)
export const IconKanban = ({ size = 14 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="6" height="16" rx="1" /><rect x="10" y="4" width="6" height="10" rx="1" /><rect x="17" y="4" width="4" height="7" rx="1" />
  </svg>
)
export const IconCheck = ({ size = 13 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round">
    <path d="M5 12l5 5L20 7" />
  </svg>
)
export const IconMore = ({ size = 16 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor">
    <circle cx="5" cy="12" r="1.5" /><circle cx="12" cy="12" r="1.5" /><circle cx="19" cy="12" r="1.5" />
  </svg>
)
export const IconPencil = ({ size = 12 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" />
  </svg>
)
export const IconSort = ({ size = 14 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M7 4v15M7 4L4 7M7 4l3 3" /><path d="M17 20V5M17 20l-3-3M17 20l3-3" />
  </svg>
)
export const IconCaret = ({ size = 13 }: SvgProps) => (
  <svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 9l6 6 6-6" />
  </svg>
)

export const EngIcon = ({ engine }: { engine: 'claude' | 'codex' }) => {
  if (engine === 'claude') {
    return (
      <span className="ag-ic" style={{ background: 'var(--accent-tint)' }}>
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M8 10l3.5 4L8 18" />
          <path d="M14 18h4" />
        </svg>
      </span>
    )
  }
  // codex
  return (
    <span className="ag-ic" style={{ background: 'var(--blue-bg)' }}>
      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.2">
        <circle cx="12" cy="12" r="7" />
        <path d="M12 8v8M8 12h8" strokeLinecap="round" />
      </svg>
    </span>
  )
}
