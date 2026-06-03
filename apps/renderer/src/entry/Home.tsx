// Home.tsx — 入口屏，对照 home.html L19-53
import { useState } from 'react'
import type { ProjectDTO } from '../api/types'
import { ProjectCard } from './ProjectCard'
import { IconPaperclip } from '../ui/icons'

const RECENT_LIMIT = 4

interface HomeProps {
  projects: ProjectDTO[]
  onSend: (text: string) => void
  onOpenProject: (id: string) => void
  onViewAll: () => void
  skillCount: number
  onOpenSkillModal: () => void
}

export function Home({ projects, onSend, onOpenProject, onViewAll, skillCount, onOpenSkillModal }: HomeProps) {
  const [text, setText] = useState('')

  const send = () => {
    const t = text.trim()
    if (!t) return
    onSend(t)
    setText('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() }
  }

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
          />
          <div className="hero-foot">
            <div className="foot-left">
              <button className="attach" title="附加文件"><IconPaperclip size={17} /></button>
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
