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
