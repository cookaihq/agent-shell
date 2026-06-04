// Home.tsx — 入口屏，对照 home.html L19-53
import { useState, useCallback } from 'react'
import type { ProjectDTO } from '../api/types'
import { ProjectCard } from './ProjectCard'
import { IconPaperclip } from '../ui/icons'
import { AttachBar, type AttachChip } from '../workspace/AttachBar'
import type { AgentShellBridge } from '@agent-shell/contracts'

const RECENT_LIMIT = 4

/** 首页暂存附件：无项目，先存「磁盘路径」或「剪贴板 blob」，提交时由 AppNav 落盘到 attachments/。 */
export type HomeAttachment =
  | { kind: 'path'; path: string; name: string; isDir: boolean }
  | { kind: 'blob'; blob: Blob; name: string }

function basename(p: string): string { return p.split(/[\\/]/).filter(Boolean).pop() ?? p }
function guessIsDir(p: string): boolean { return !/\.[^./\\]+$/.test(basename(p)) }

interface HomeProps {
  projects: ProjectDTO[]
  onSend: (text: string, staged: HomeAttachment[]) => void
  onOpenProject: (id: string) => void
  onViewAll: () => void
  skillCount: number
  onOpenSkillModal: () => void
}

export function Home({ projects, onSend, onOpenProject, onViewAll, skillCount, onOpenSkillModal }: HomeProps) {
  const [text, setText] = useState('')
  const [staged, setStaged] = useState<HomeAttachment[]>([])

  const send = () => {
    const t = text.trim()
    if (!t && staged.length === 0) return
    onSend(t, staged)
    setText('')
    setStaged([])
  }

  // 回形针：原生选择器拿绝对路径（文件/文件夹/多选），暂存不落盘
  const pickAttachments = useCallback(async () => {
    const bridge = (globalThis as { agentShell?: AgentShellBridge }).agentShell
    if (!bridge) return
    const paths = await bridge.pickPaths()
    if (paths.length === 0) return
    setStaged((prev) => [...prev, ...paths.map((p): HomeAttachment => ({ kind: 'path', path: p, name: basename(p), isDir: guessIsDir(p) }))])
  }, [])

  // 粘贴：剪贴板字节无源路径 → 暂存 blob，提交时上传
  const onPaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items
    if (!items) return
    for (const it of Array.from(items)) {
      if (it.kind !== 'file') continue
      const f = it.getAsFile()
      if (f) setStaged((prev) => [...prev, { kind: 'blob', blob: f, name: f.name || `pasted-${f.type.split('/')[1] || 'bin'}` }])
    }
  }, [])

  const removeStaged = useCallback((idx: number) => setStaged((prev) => prev.filter((_, i) => i !== idx)), [])

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

  const chips: AttachChip[] = staged.map((s) => ({ name: s.name, kind: s.kind === 'path' && s.isDir ? 'dir' : 'file' }))

  return (
    <div className="home">
      <section className="hero">
        <div className="hero-brand">
          <span className="mark">
            <svg viewBox="0 0 32 32" fill="none">
              <path d="M9 11l4 5-4 5" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M16 22h7" stroke="var(--accent)" strokeWidth="2.4" strokeLinecap="round" />
            </svg>
          </span>
          <span className="nm">Agent Shell</span>
        </div>
        <h1 className="hero-title">今天想构建点什么？</h1>
        <p className="hero-sub">本地优先的开源编码 agent 客户端</p>
        <div className="input-card">
          <textarea
            className="hero-input"
            placeholder="描述你想让 agent 做的事——写一个功能、修一个 bug、生成一份提案 deck……"
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={onPaste}
          />
          {staged.length > 0 && <AttachBar attachments={chips} onRemove={removeStaged} />}
          <div className="hero-foot">
            <div className="foot-left">
              <button className="attach" title="附加文件" type="button" onClick={() => void pickAttachments()}><IconPaperclip size={17} /></button>
              <div className="skill-inject">
                <button
                  className={`skill-inject-btn${skillCount > 0 ? ' has' : ''}`}
                  type="button"
                  onClick={onOpenSkillModal}
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M12 3l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z" />
                  </svg>
                  注入技能{skillCount > 0 && <span className="si-count">{skillCount}</span>}
                </button>
              </div>
            </div>
            <a className="submit" title="发送" onClick={(e) => { e.preventDefault(); send() }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </a>
          </div>
        </div>
      </section>

      <section className="section">
        <div className="section-head">
          <h2 className="section-title recent-title">最近项目</h2>
          <a className="view-all" onClick={(e) => { e.preventDefault(); onViewAll() }}>查看全部 →</a>
        </div>
        <div className="proj-row">
          {projects.slice(0, RECENT_LIMIT).map((p) => (
            <ProjectCard key={p.id} project={p} onOpen={onOpenProject} />
          ))}
        </div>
      </section>
    </div>
  )
}
