// rail「任务自动化」独立面（spec §6.1）：头部 + 分类筛选器（超两行折叠）+ 列表（卡含分类 chips）+ 新建/编辑弹窗 + 运行历史抽屉。
// 视觉与交互对齐原型开发版 tasks.html。数据来自 daemon /automations（真实，非 mock）。
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { scheduleSummary, type AutomationRunStatus } from '@agent-shell/contracts'
import type { AutomationDTO, ProjectDTO } from '../api/types'
import { api } from '../api/client'
import { AutomationModal } from './AutomationModal'
import { RunHistoryDrawer } from './RunHistoryDrawer'
import templatesData from './templates.zh.json'

// 模板（移植 open-design + 中文化，见 specs/2026-06-05-app-feedback-batch-2.md Issue 1）。
// V1 仅渲染 status==='active' 的 4 条；pending 存档不渲染。
interface AutomationTemplate {
  id: string
  source: string
  category: string
  status: 'active' | 'pending'
  requires: string[]
  adapted: boolean
  icon: string
  title: string
  description: string
  defaultName: string
  prompt: string
}
const TEMPLATES = templatesData as unknown as AutomationTemplate[]
const ACTIVE_TEMPLATES = TEMPLATES.filter((t) => t.status === 'active')

// 模板分类 → 中文 chip 文案（active 涉及的分类）。
const TPL_CAT_ZH: Record<string, string> = {
  memory: '记忆',
  release: '发布',
  quality: '质量',
  'live-artifact': '实时看板',
}
const tplCatLabel = (c: string) => TPL_CAT_ZH[c] ?? c

// 模板图标：沿用 open-design icon 名 → renderer SVG；映射不到回退默认时钟图标。
function TemplateIcon({ name }: { name: string }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'sparkles':
      return <svg {...common}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></svg>
    case 'present':
      return <svg {...common}><rect x="3" y="8" width="18" height="13" rx="1" /><path d="M3 12h18M12 8v13M12 8S9 3 6.5 4.5 9 8 12 8zM12 8s3-5 5.5-3.5S15 8 12 8z" /></svg>
    case 'bell':
      return <svg {...common}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
    case 'file-code':
      return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M10 13l-2 2 2 2M14 13l2 2-2 2" /></svg>
    default:
      // TODO(feedback-2): icon 未映射，回退默认时钟图标
      return <svg {...common} strokeLinecap="butt"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>
  }
}

const PERM_ZH: Record<string, string> = {
  default: '改动前问', acceptEdits: '自动编辑', plan: '计划', auto: '自动', bypassPermissions: '绕过',
  'read-only': '只读', 'workspace-write': '工作区可写', 'danger-full-access': '完全访问',
}
const LAST_STATUS: Record<AutomationRunStatus, { text: string; color: string }> = {
  queued: { text: '排队中', color: 'var(--text-muted)' },
  running: { text: '运行中', color: 'var(--accent)' },
  succeeded: { text: '已完成', color: 'var(--text-muted)' },
  failed: { text: '失败', color: 'var(--red)' },
  'needs-review': { text: '待复核', color: 'var(--purple)' },
  canceled: { text: '已取消', color: 'var(--text-muted)' },
}
function nextStamp(ms: number | null): string {
  if (!ms) return '未排'
  const d = new Date(ms)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}

export interface TaskAutomationProps {
  projects: ProjectDTO[]
  onOpenSession: (projectId: string, sessionId: string) => void
}

export function TaskAutomation({ projects, onOpenSession }: TaskAutomationProps) {
  const [items, setItems] = useState<AutomationDTO[] | null>(null)
  const [activeCat, setActiveCat] = useState('')          // '' = 全部
  const [collapsed, setCollapsed] = useState(true)
  const [showToggle, setShowToggle] = useState(false)
  const [editing, setEditing] = useState<AutomationDTO | null>(null)
  const [creating, setCreating] = useState(false)
  const [prefill, setPrefill] = useState<{ name: string; prompt: string; categories: string[] } | null>(null)
  const [tplCat, setTplCat] = useState('')          // 模板区分类筛选：'' = 全部
  const [histFor, setHistFor] = useState<AutomationDTO | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const chipsRef = useRef<HTMLDivElement>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reload = useCallback(async () => {
    try { setItems((await api.listAutomations()).automations) } catch { setItems([]) }
  }, [])
  useEffect(() => { void reload() }, [reload])

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }

  const allCats = useMemo(() => Array.from(new Set((items ?? []).flatMap((a) => a.categories))), [items])
  // 折叠态下内容高度超过两行 → 显示「展开全部分类」
  useLayoutEffect(() => {
    const el = chipsRef.current
    if (el) setShowToggle(el.scrollHeight > el.clientHeight + 2)
  }, [allCats, collapsed])

  const enabledCount = (items ?? []).filter((a) => a.enabled).length
  const pausedCount = (items ?? []).filter((a) => !a.enabled).length
  const visible = (items ?? []).filter((a) => !activeCat || a.categories.includes(activeCat))

  const targetLabel = (a: AutomationDTO) => {
    const t = a.target
    if (t.mode === 'reuse') return `复用 ${projects.find((p) => p.id === t.projectId)?.name ?? '项目'}`
    return '每次新建会话'
  }

  // 模板区：active 模板涉及的分类（去重，保序），用于筛选 chips。
  const tplCats = useMemo(() => Array.from(new Set(ACTIVE_TEMPLATES.map((t) => t.category))), [])
  const visibleTemplates = ACTIVE_TEMPLATES.filter((t) => !tplCat || t.category === tplCat)
  // 点「使用模板」→ 进新建态，把模板预填进弹窗（标题/prompt/分类）。
  const onUseTemplate = (t: AutomationTemplate) => {
    setPrefill({ name: t.defaultName, prompt: t.prompt, categories: [tplCatLabel(t.category)] })
    setCreating(true)
  }

  const onRun = async (a: AutomationDTO) => { try { await api.runAutomation(a.id); showToast(`已触发「${a.name}」`); setTimeout(() => void reload(), 600) } catch { showToast('触发失败') } }
  const onToggleEnabled = async (a: AutomationDTO) => { try { await api.patchAutomation(a.id, { enabled: !a.enabled }); void reload() } catch { showToast('操作失败') } }
  const onDelete = async (a: AutomationDTO) => { if (!confirm(`删除自动化「${a.name}」？此操作不可撤销。`)) return; try { await api.deleteAutomation(a.id); showToast('已删除'); void reload() } catch { showToast('删除失败') } }

  return (
    <>
      {/* 头部 */}
      <div>
        <span className="auto-kicker">定时 AGENT 会话</span>
        <div className="auto-head">
          <div>
            <h1 className="auto-title">任务自动化</h1>
            <p className="auto-sub">定时或手动触发，让 agent 在后台无人值守跑一条会话；app 关窗后留在菜单栏继续守时，产出留成可回看的会话与运行历史。</p>
          </div>
          <div className="auto-actions">
            <div className="auto-stats">
              <span className="st"><b>{enabledCount}</b>启用</span>
              <span className="st"><b>{pausedCount}</b>暂停</span>
            </div>
            <button className="auto-new" onClick={() => setCreating(true)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>新建自动化
            </button>
          </div>
        </div>
      </div>

      {/* 列表 */}
      <section className="section" style={{ gap: 12 }}>
        <h2 className="auto-sec-title">你的自动化</h2>
        {allCats.length > 0 && (
          <div className="tag-filter">
            <div className={`tag-filter-chips${collapsed ? ' collapsed' : ''}`} ref={chipsRef}>
              <button className={`tagf${activeCat === '' ? ' is-active' : ''}`} type="button" onClick={() => setActiveCat('')}>全部</button>
              {allCats.map((c) => (
                <button key={c} className={`tagf${activeCat === c ? ' is-active' : ''}`} type="button" onClick={() => setActiveCat(c)}>{c}</button>
              ))}
            </div>
            {showToggle && (
              <button className="tag-filter-toggle" type="button" onClick={() => setCollapsed((v) => !v)}>{collapsed ? '展开全部分类' : '收起'}</button>
            )}
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items !== null && visible.map((a) => (
            <div className="auto-card" key={a.id}>
              <span className="aic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              <div className="amain">
                <div className="aname">{a.name}</div>
                <div className="ameta">
                  {scheduleSummary(a.schedule)} · {targetLabel(a)} · 权限：{PERM_ZH[a.permission] ?? a.permission}
                  {a.lastRun ? <> · 上次 <span style={{ color: LAST_STATUS[a.lastRun.status].color }}>{LAST_STATUS[a.lastRun.status].text}</span></> : null}
                  {' · 下次 '}{a.enabled ? nextStamp(a.nextRunAt) : '已暂停'}
                </div>
                {a.prompt && <div className="adesc">{a.prompt}</div>}
                {a.categories.length > 0 && <div className="auto-tags">{a.categories.map((c) => <span className="auto-tag" key={c}>{c}</span>)}</div>}
              </div>
              <div className="aacts">
                <button className="auto-btn" onClick={() => void onRun(a)}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>运行</button>
                <button className="auto-btn" onClick={() => setHistFor(a)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" /></svg>历史</button>
                <button className="auto-btn" onClick={() => setEditing(a)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>编辑</button>
                <button className="auto-btn" onClick={() => void onToggleEnabled(a)}>
                  {a.enabled
                    ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>暂停</>
                    : <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>启用</>}
                </button>
                <button className="auto-btn ic danger" onClick={() => void onDelete(a)} aria-label="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg></button>
              </div>
            </div>
          ))}
        </div>
        {items !== null && visible.length === 0 && (
          <div className="auto-empty" style={{ color: 'var(--text-faint)', fontSize: 13, padding: '14px 2px' }}>
            {activeCat ? '该分类下暂无自动化。' : '还没有自动化，点右上角「新建自动化」创建一条。'}
          </div>
        )}
      </section>

      {/* 模板区 */}
      <section className="section" style={{ gap: 12 }}>
        <div>
          <h2 className="auto-sec-title">模板</h2>
          <p className="auto-sub" style={{ marginTop: 2 }}>从模板快速新建一条自动化。</p>
        </div>
        {tplCats.length > 0 && (
          <div className="tag-filter">
            <div className="tag-filter-chips">
              <button className={`tagf${tplCat === '' ? ' is-active' : ''}`} type="button" onClick={() => setTplCat('')}>全部</button>
              {tplCats.map((c) => (
                <button key={c} className={`tagf${tplCat === c ? ' is-active' : ''}`} type="button" onClick={() => setTplCat(c)}>{tplCatLabel(c)}</button>
              ))}
            </div>
          </div>
        )}
        {/* 模板卡片网格：用 Agent Shell 现有 token 内联布局（base.css 未加新类，避免越界改样式）。 */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))', gap: 12 }}>
          {visibleTemplates.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onUseTemplate(t)}
              style={{
                display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8,
                textAlign: 'left', padding: '14px 14px 12px', cursor: 'pointer',
                border: '1px solid var(--border)', borderRadius: 'var(--radius)',
                background: 'var(--bg-panel)', boxShadow: 'var(--shadow-xs)', color: 'var(--text)',
                transition: '.12s',
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'color-mix(in srgb,var(--accent) 32%,var(--border))'; e.currentTarget.style.background = 'var(--bg-subtle)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-panel)' }}
            >
              <span style={{ width: 32, height: 32, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-tint)', color: 'var(--accent)' }}>
                <TemplateIcon name={t.icon} />
              </span>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-muted)' }}>{tplCatLabel(t.category)}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', lineHeight: 1.35 }}>{t.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, flex: 1 }}>{t.description}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', marginTop: 2 }}>使用模板 ›</div>
            </button>
          ))}
        </div>
      </section>

      {(creating || editing) && (
        <AutomationModal
          initial={editing}
          prefill={editing ? null : prefill}
          projects={projects}
          knownCategories={allCats}
          onClose={() => { setCreating(false); setEditing(null); setPrefill(null) }}
          onSaved={() => { setCreating(false); setEditing(null); setPrefill(null); void reload() }}
        />
      )}
      {histFor && <RunHistoryDrawer automation={histFor} onClose={() => setHistFor(null)} onOpenSession={onOpenSession} />}
      {toast && <div className="proj-toast show">{toast}</div>}
    </>
  )
}
