import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { Skill } from '../api/types'
import { AddSkillModal } from './AddSkillModal'

// ── inline SVGs (1:1 from prototype SK_ICON) ─────────────────────────────────

const IconGrid = () => (
  <svg viewBox="0 0 24 24" width={18} height={18} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
    <rect x="4" y="4" width="7" height="7" rx="1"/>
    <rect x="13" y="4" width="7" height="7" rx="1"/>
    <rect x="4" y="13" width="7" height="7" rx="1"/>
    <rect x="13" y="13" width="7" height="7" rx="1"/>
  </svg>
)

const IconTrash = () => (
  <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/>
  </svg>
)

const IconRefresh = () => (
  <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-3-6.7"/>
    <path d="M21 4v5h-5"/>
  </svg>
)

const IconGit = () => (
  <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="6" r="2.5"/>
    <circle cx="6" cy="6" r="2.5"/>
    <circle cx="6" cy="18" r="2.5"/>
    <path d="M6 8.5v7M18 8.5a6 6 0 0 1-6 6H8"/>
  </svg>
)

const IconFolder = () => (
  <svg viewBox="0 0 24 24" width={13} height={13} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
  </svg>
)

const IconPlus = () => (
  <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round">
    <path d="M12 5v14M5 12h14"/>
  </svg>
)

const SRC_LABEL: Record<string, string> = { git: 'Git', folder: '文件夹' }

// ── SkillRow ──────────────────────────────────────────────────────────────────

interface SkillRowProps {
  skill: Skill
  onDelete: (name: string) => void
  onUpdate: (name: string) => void
  updating: boolean
}

function SkillRow({ skill: s, onDelete, onUpdate, updating }: SkillRowProps) {
  return (
    <div className="skill-row" data-name={s.name} data-source={s.source}>
      <span className="skill-ic"><IconGrid /></span>
      <div className="skill-main">
        <div className="skill-name-row">
          <span className="skill-name">{s.name}</span>
          <span className="skill-src">
            {s.source === 'git' ? <IconGit /> : <IconFolder />}
            {SRC_LABEL[s.source]}
          </span>
        </div>
        <div className="skill-desc">{s.desc || '（无描述）'}</div>
        <div className="skill-origin">{s.origin || ''}</div>
      </div>
      <div className="skill-actions">
        {s.source === 'git' && (
          <button
            className="skill-act"
            title="更新（从 Git 重新拉取）"
            type="button"
            onClick={() => onUpdate(s.name)}
            disabled={updating}
          >
            {updating ? '✓' : <IconRefresh />}
          </button>
        )}
        <button
          className="skill-act"
          title="从库中移除"
          type="button"
          onClick={() => onDelete(s.name)}
        >
          <IconTrash />
        </button>
      </div>
    </div>
  )
}

// ── SkillsSettings ────────────────────────────────────────────────────────────

export function SkillsSettings() {
  const [skills, setSkills] = useState<Skill[]>([])
  const [query, setQuery] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [updatingName, setUpdatingName] = useState<string | null>(null)

  useEffect(() => {
    api.listSkills()
      .then(r => setSkills(r.skills))
      .catch(() => setSkills([]))
  }, [])

  const filtered = query
    ? skills.filter(s =>
        s.name.toLowerCase().includes(query.toLowerCase()) ||
        (s.desc || '').toLowerCase().includes(query.toLowerCase())
      )
    : skills

  const handleDelete = async (name: string) => {
    await api.deleteSkill(name).catch(() => null)
    setSkills(prev => prev.filter(s => s.name !== name))
  }

  const handleUpdate = async (name: string) => {
    setUpdatingName(name)
    try {
      const res = await api.updateSkill(name)
      setSkills(prev => prev.map(s => s.name === name ? res.skill : s))
    } catch {
      // no-op: keep old state
    }
    setTimeout(() => setUpdatingName(null), 800)
  }

  const handleImported = (skill: Skill) => {
    // Re-fetch list to get authoritative state, or prepend
    api.listSkills()
      .then(r => setSkills(r.skills))
      .catch(() => setSkills(prev => [skill, ...prev]))
    setShowAdd(false)
  }

  return (
    <>
      <p className="set-kicker">设置</p>
      <h2 className="set-h">技能</h2>
      <p className="set-sub">智能体可调用的 SKILL.md 技能库。这里是"你拥有哪些技能"的清单；某次任务真正生效的，由发送时的「注入技能」决定。</p>
      <div className="skill-toolbar">
        <input
          className="skill-search"
          placeholder="搜索技能…"
          value={query}
          onChange={e => setQuery(e.target.value)}
        />
        <button className="skill-new" type="button" onClick={() => setShowAdd(true)}>
          <IconPlus />添加技能
        </button>
      </div>
      <div className="skill-list">
        {filtered.map(s => (
          <SkillRow
            key={s.name}
            skill={s}
            onDelete={handleDelete}
            onUpdate={handleUpdate}
            updating={updatingName === s.name}
          />
        ))}
      </div>
      <div className="mcp-foot" style={{ marginTop: 16 }}>
        <span className="saved-pill">所有更改已保存</span>
        <span className="storage">技能库存于 <code>~/.agent-shell/skills</code>（可在「系统设置」修改）</span>
      </div>
      {showAdd && (
        <AddSkillModal
          onImported={handleImported}
          onClose={() => setShowAdd(false)}
        />
      )}
    </>
  )
}
