// rail「任务自动化」面（spec §6.1）：头部 + 分类层级筛选(drill) + 标签筛选(AND) + 卡片(面包屑/标签/配置标志/多触发 meta)
// + 设置弹窗 + 管理分类模态 + 运行历史抽屉。新建/编辑 = agent-led（组装提示词塞首页）。视觉对齐原型开发版 tasks.html。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AutomationDTO, AutomationRunStatus, CatNode, EntityRequirement, ProjectDTO } from '../api/types'
import { api } from '../api/client'
import { triggerSummary } from './triggers'
import { findNode } from './categoryTree'
import { AutomationSettingsModal } from './AutomationModal'
import { CategoryManagerModal } from './CategoryManagerModal'
import { RunHistoryDrawer } from './RunHistoryDrawer'
import templatesData from './templates.zh.json'

interface AutomationTemplate {
  id: string; source: string; category: string; status: 'active' | 'pending'; requires: string[]
  adapted: boolean; icon: string; title: string; description: string; defaultName: string; prompt: string
}
const TEMPLATES = templatesData as unknown as AutomationTemplate[]
const ACTIVE_TEMPLATES = TEMPLATES.filter((t) => t.status === 'active')
const TPL_CAT_ZH: Record<string, string> = { memory: '记忆', release: '发布', quality: '质量', 'live-artifact': '实时看板' }
const tplCatLabel = (c: string) => TPL_CAT_ZH[c] ?? c

function TemplateIcon({ name }: { name: string }) {
  const common = { width: 18, height: 18, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
  switch (name) {
    case 'sparkles': return <svg {...common}><path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6z" /><path d="M19 14l.8 2.2L22 17l-2.2.8L19 20l-.8-2.2L16 17l2.2-.8z" /></svg>
    case 'present': return <svg {...common}><rect x="3" y="8" width="18" height="13" rx="1" /><path d="M3 12h18M12 8v13M12 8S9 3 6.5 4.5 9 8 12 8zM12 8s3-5 5.5-3.5S15 8 12 8z" /></svg>
    case 'bell': return <svg {...common}><path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9" /><path d="M13.7 21a2 2 0 0 1-3.4 0" /></svg>
    case 'file-code': return <svg {...common}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M10 13l-2 2 2 2M14 13l2 2-2 2" /></svg>
    default: return <svg {...common} strokeLinecap="butt"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" /></svg>
  }
}

const PERM_ZH: Record<string, string> = {
  default: '改动前问', acceptEdits: '自动编辑', plan: '计划', auto: '自动', bypassPermissions: '绕过',
  'read-only': '只读', 'workspace-write': '工作区可写', 'danger-full-access': '完全访问',
}
const LAST_STATUS: Record<AutomationRunStatus, { text: string; color: string }> = {
  queued: { text: '排队中', color: 'var(--text-muted)' }, running: { text: '运行中', color: 'var(--accent)' },
  succeeded: { text: '已完成', color: 'var(--text-muted)' }, failed: { text: '失败', color: 'var(--red)' },
  'needs-review': { text: '待复核', color: 'var(--purple)' }, canceled: { text: '已取消', color: 'var(--text-muted)' },
}
function nextStamp(ms: number | null): string {
  if (!ms) return '未排'
  const d = new Date(ms); const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}

// agent-led 提示词：新建 / 编辑（内容交给 agent，用 create_automation 工具落地）。
const NEW_PROMPT = [
  '我想新建一个定时自动化任务，请帮我创建。需要确认这些信息：',
  '1. 任务做什么（要无人值守跑的完整指令）',
  '2. 触发时机（启动时 / 每小时 / 每天 / 工作日 / 每周 + 时间、时区，可多个）',
  '3. 用 Claude 还是 Codex、哪个权限档',
  '4. 归到哪个分类（层级，可新建）、打哪些标签',
  '5. 每次新建项目还是复用某个已有项目',
  '6. 用 agent 跑还是脚本直跑',
  '信息齐了就用 create_automation 工具落地。',
].join('\n')
const editPrompt = (name: string) =>
  `我想修改定时自动化任务「${name}」的内容（指令）。请先把它当前的指令读给我，然后按我的要求改，确认后用 create_automation 工具更新它。`
const templatePrompt = (t: AutomationTemplate) =>
  `请按这个模板帮我建一个定时自动化任务：\n名称建议：${t.defaultName}\n要做的事：${t.prompt}\n和我确认触发时机/引擎/分类后用 create_automation 工具落地。`

export interface TaskAutomationProps {
  projects: ProjectDTO[]
  onOpenSession: (projectId: string, sessionId: string) => void
  /** agent-led 入口：把组装好的提示词塞首页 composer（新建/编辑/模板都走它）。 */
  onComposeToHome: (text: string) => void
}

export function TaskAutomation({ projects, onOpenSession, onComposeToHome }: TaskAutomationProps) {
  const [items, setItems] = useState<AutomationDTO[] | null>(null)
  const [catTree, setCatTree] = useState<CatNode[]>([])
  const [reqsBy, setReqsBy] = useState<Record<string, EntityRequirement>>({})
  const [filterCatPath, setFilterCatPath] = useState<string[]>([])   // 分类层级 drill，[] = 全部
  const [filterTags, setFilterTags] = useState<Set<string>>(new Set())
  const [settingsFor, setSettingsFor] = useState<AutomationDTO | null>(null)
  const [showCatMgr, setShowCatMgr] = useState(false)
  const [tplCat, setTplCat] = useState('')
  const [histFor, setHistFor] = useState<AutomationDTO | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const reload = useCallback(async () => {
    try { setItems((await api.listAutomations()).automations) } catch { setItems([]) }
    try { setReqsBy((await api.listEntityRequirements()).requirements) } catch { /* 配置标志降级 */ }
  }, [])
  useEffect(() => { void reload() }, [reload])
  useEffect(() => { void api.listAutomationCategories().then((r) => setCatTree(r.tree)).catch(() => {}) }, [])

  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2200)
  }

  const enabledCount = (items ?? []).filter((a) => a.enabled).length
  const pausedCount = (items ?? []).filter((a) => !a.enabled).length
  const allTags = useMemo(() => Array.from(new Set((items ?? []).flatMap((a) => a.tags))), [items])
  const curChildren = filterCatPath.length === 0 ? catTree : (findNode(catTree, filterCatPath)?.children ?? [])

  const pref = filterCatPath.join('/')
  const catMatch = (a: AutomationDTO) => { if (!pref) return true; const cp = a.category.join('/'); return cp === pref || cp.startsWith(pref + '/') }
  const tagMatch = (a: AutomationDTO) => filterTags.size === 0 || [...filterTags].every((t) => a.tags.includes(t))
  const visible = (items ?? []).filter((a) => catMatch(a) && tagMatch(a))

  const targetLabel = (a: AutomationDTO) => { const t = a.target; return t.mode === 'reuse' ? `复用 ${projects.find((p) => p.id === t.projectId)?.name ?? '项目'}` : '每次新建会话' }
  const cfgBadge = (a: AutomationDTO) => {
    const envs = (a.requires ?? []).filter((r) => r.kind === 'env')
    if (envs.length === 0) return null
    const slots = reqsBy[`automation:${a.id}`]?.slots ?? []
    const allBound = envs.every((r) => slots.find((s) => s.name === r.name)?.bind)
    return allBound ? { cls: 'cfg-badge--done', text: '已配置' } : { cls: 'cfg-badge--need', text: '需配置' }
  }

  const tplCats = useMemo(() => Array.from(new Set(ACTIVE_TEMPLATES.map((t) => t.category))), [])
  const visibleTemplates = ACTIVE_TEMPLATES.filter((t) => !tplCat || t.category === tplCat)
  const toggleTagFilter = (t: string) => setFilterTags((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n })

  const onRun = async (a: AutomationDTO) => { try { await api.runAutomation(a.id); showToast(`已触发「${a.name}」`); setTimeout(() => void reload(), 600) } catch { showToast('触发失败') } }
  const onToggleEnabled = async (a: AutomationDTO) => { try { await api.patchAutomation(a.id, { enabled: !a.enabled }); void reload() } catch { showToast('操作失败') } }
  const onDelete = async (a: AutomationDTO) => { if (!confirm(`删除自动化「${a.name}」？此操作不可撤销。`)) return; try { await api.deleteAutomation(a.id); showToast('已删除'); void reload() } catch { showToast('删除失败') } }

  return (
    <>
      <div>
        <span className="auto-kicker">定时 AGENT 会话</span>
        <div className="auto-head">
          <div>
            <h1 className="auto-title">任务自动化</h1>
            <p className="auto-sub">定时或手动触发，让 agent 在后台无人值守跑一条会话；产出留成可回看的会话与运行历史。新建/编辑交给 agent。</p>
          </div>
          <div className="auto-actions">
            <div className="auto-stats">
              <span className="st"><b>{enabledCount}</b>启用</span>
              <span className="st"><b>{pausedCount}</b>暂停</span>
            </div>
            <button className="auto-new" onClick={() => onComposeToHome(NEW_PROMPT)}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>新建自动化
            </button>
          </div>
        </div>
      </div>

      <section className="section" style={{ gap: 12 }}>
        <h2 className="auto-sec-title">你的自动化</h2>
        {/* 分类层级筛选（drill）+ 标签筛选（多选 AND） */}
        <div className="auto-filters" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div className="auto-cat-filter" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center' }}>
            <button className={`tagf${filterCatPath.length === 0 ? ' is-active' : ''}`} type="button" onClick={() => setFilterCatPath([])}>全部</button>
            {filterCatPath.map((seg, i) => <button key={`${seg}-${i}`} className="tagf is-active" type="button" onClick={() => setFilterCatPath(filterCatPath.slice(0, i + 1))}>{seg} ›</button>)}
            {curChildren.map((c) => <button key={c.name} className="tagf" type="button" onClick={() => setFilterCatPath([...filterCatPath, c.name])}>{c.name}</button>)}
            <button className="cat-mgmt-link" type="button" onClick={() => setShowCatMgr(true)} style={{ marginLeft: 'auto' }}>管理分类…</button>
          </div>
          {allTags.length > 0 && (
            <div className="auto-tag-filter" style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {allTags.map((t) => <button key={t} className={`tagf${filterTags.has(t) ? ' is-active' : ''}`} type="button" onClick={() => toggleTagFilter(t)}>{t}</button>)}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {items !== null && visible.map((a) => {
            const badge = cfgBadge(a)
            return (
              <div className="auto-card" key={a.id}>
                <span className="aic"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
                <div className="amain">
                  {a.category.length > 0 && (
                    <div className="acat" style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11.5, color: 'var(--text-muted)' }}>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
                      <span>{a.category.join(' › ')}</span>
                    </div>
                  )}
                  <div className="aname" style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {a.name}
                    {badge && <span className={`cfg-badge ${badge.cls}`}>{badge.text}</span>}
                  </div>
                  <div className="ameta">
                    {a.triggers.map(triggerSummary).join(' · ')} · {targetLabel(a)} · 权限：{PERM_ZH[a.permission] ?? a.permission}
                    {a.lastRun ? <> · 上次 <span style={{ color: LAST_STATUS[a.lastRun.status].color }}>{LAST_STATUS[a.lastRun.status].text}</span></> : null}
                    {' · 下次 '}{a.enabled ? nextStamp(a.nextRunAt) : '已暂停'}
                  </div>
                  {a.tags.length > 0 && <div className="auto-tags">{a.tags.map((t) => <span className="auto-tag" key={t}>{t}</span>)}</div>}
                </div>
                <div className="aacts">
                  <button className="auto-btn" onClick={() => void onRun(a)}><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>运行</button>
                  <button className="auto-btn" onClick={() => setHistFor(a)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 12a9 9 0 1 0 3-6.7L3 8" strokeLinecap="round" strokeLinejoin="round" /><path d="M3 4v4h4" strokeLinecap="round" strokeLinejoin="round" /></svg>历史</button>
                  <button className="auto-btn" onClick={() => onComposeToHome(editPrompt(a.name))}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>编辑</button>
                  <button className="auto-btn" onClick={() => setSettingsFor(a)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" /></svg>设置</button>
                  <button className="auto-btn" onClick={() => void onToggleEnabled(a)}>
                    {a.enabled
                      ? <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1" /><rect x="14" y="5" width="4" height="14" rx="1" /></svg>暂停</>
                      : <><svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z" /></svg>启用</>}
                  </button>
                  <button className="auto-btn ic danger" onClick={() => void onDelete(a)} aria-label="删除"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" /></svg></button>
                </div>
              </div>
            )
          })}
        </div>
        {items !== null && visible.length === 0 && (
          <div className="auto-empty" style={{ color: 'var(--text-faint)', fontSize: 13, padding: '14px 2px' }}>
            {pref || filterTags.size ? '当前筛选下暂无自动化。' : '还没有自动化，点右上角「新建自动化」让 agent 帮你建一条。'}
          </div>
        )}
      </section>

      <section className="section" style={{ gap: 12 }}>
        <div><h2 className="auto-sec-title">模板</h2><p className="auto-sub" style={{ marginTop: 2 }}>从模板快速新建一条自动化（交给 agent 落地）。</p></div>
        {tplCats.length > 0 && (
          <div className="tag-filter"><div className="tag-filter-chips">
            <button className={`tagf${tplCat === '' ? ' is-active' : ''}`} type="button" onClick={() => setTplCat('')}>全部</button>
            {tplCats.map((c) => <button key={c} className={`tagf${tplCat === c ? ' is-active' : ''}`} type="button" onClick={() => setTplCat(c)}>{tplCatLabel(c)}</button>)}
          </div></div>
        )}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(248px,1fr))', gap: 12 }}>
          {visibleTemplates.map((t) => (
            <button key={t.id} type="button" onClick={() => onComposeToHome(templatePrompt(t))}
              style={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 8, textAlign: 'left', padding: '14px 14px 12px', cursor: 'pointer', border: '1px solid var(--border)', borderRadius: 'var(--radius)', background: 'var(--bg-panel)', boxShadow: 'var(--shadow-xs)', color: 'var(--text)', transition: '.12s' }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'color-mix(in srgb,var(--accent) 32%,var(--border))'; e.currentTarget.style.background = 'var(--bg-subtle)' }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-panel)' }}>
              <span style={{ width: 32, height: 32, borderRadius: 8, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: 'var(--accent-tint)', color: 'var(--accent)' }}><TemplateIcon name={t.icon} /></span>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '.04em', color: 'var(--text-muted)' }}>{tplCatLabel(t.category)}</div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-strong)', lineHeight: 1.35 }}>{t.title}</div>
              <div style={{ fontSize: 12.5, color: 'var(--text-muted)', lineHeight: 1.5, flex: 1 }}>{t.description}</div>
              <div style={{ fontSize: 12.5, fontWeight: 600, color: 'var(--accent)', marginTop: 2 }}>使用模板 ›</div>
            </button>
          ))}
        </div>
      </section>

      {settingsFor && (
        <AutomationSettingsModal
          automation={settingsFor} projects={projects} categoryTree={catTree}
          onOpenCategoryManager={() => setShowCatMgr(true)}
          onClose={() => setSettingsFor(null)}
          onSaved={() => { setSettingsFor(null); void reload() }}
        />
      )}
      {showCatMgr && <CategoryManagerModal onClose={() => setShowCatMgr(false)} onChanged={setCatTree} />}
      {histFor && <RunHistoryDrawer automation={histFor} onClose={() => setHistFor(null)} onOpenSession={onOpenSession} />}
      {toast && <div className="proj-toast show">{toast}</div>}
    </>
  )
}
