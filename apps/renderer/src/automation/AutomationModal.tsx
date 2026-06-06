// 新建/编辑自动化弹窗（4 pill：引擎·模型·权限一体 / 调度 / 目标项目 / 分类）。
// 视觉与交互对齐原型开发版 tasks.html；点 pill 弹层、点空白处关、互斥；选 bypass 附风险提示。
import { useEffect, useMemo, useRef, useState } from 'react'
import { scheduleSummary, type AutomationSchedule } from '@agent-shell/contracts'
import type { AutomationDTO, AutomationTarget, Engine, ProjectDTO } from '../api/types'
import { api } from '../api/client'

// 引擎 → 模型 + 权限档（claude 5 档 / codex 沙箱 3 档），默认取最宽。模型用 app 真实别名（与新建会话 DEFAULT_MODEL 一致）。
const AGENTS: Record<Engine, { label: string; models: { v: string; l: string }[]; perms: [string, string][]; permDefault: number }> = {
  claude: {
    label: 'Claude',
    models: [{ v: 'opus', l: 'Opus' }, { v: 'sonnet', l: 'Sonnet' }, { v: 'haiku', l: 'Haiku' }],
    perms: [['改动前问', 'default'], ['自动编辑', 'acceptEdits'], ['计划', 'plan'], ['自动', 'auto'], ['绕过', 'bypassPermissions']],
    permDefault: 4,
  },
  codex: {
    label: 'Codex',
    models: [{ v: 'gpt-5.5', l: 'GPT-5.5' }],
    perms: [['只读', 'read-only'], ['工作区可写', 'workspace-write'], ['完全访问', 'danger-full-access']],
    permDefault: 2,
  },
}
const TZ_OPTIONS: [string, string][] = [['Asia/Shanghai', '上海'], ['UTC', 'UTC'], ['America/New_York', '纽约'], ['Asia/Tokyo', '东京']]
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']
type Freq = '每小时' | '每天' | '工作日' | '每周'

type Pop = 'eng' | 'sched' | 'proj' | 'tag' | null

export interface AutomationModalProps {
  /** 编辑时传入现有自动化；新建为 null。 */
  initial: AutomationDTO | null
  /** 模板预填（新建态）：仅预填标题/prompt/分类，其余字段走新建默认值。与 initial 互斥（编辑优先）。 */
  prefill?: { name: string; prompt: string; categories: string[] } | null
  projects: ProjectDTO[]
  /** 已有分类候选（来自其它自动化），分类 pill 预填。 */
  knownCategories: string[]
  onClose: () => void
  onSaved: () => void
}

export function AutomationModal({ initial, prefill, projects, knownCategories, onClose, onSaved }: AutomationModalProps) {
  const [title, setTitle] = useState(initial?.name ?? prefill?.name ?? '')
  const [prompt, setPrompt] = useState(initial?.prompt ?? prefill?.prompt ?? '')
  const [engine, setEngine] = useState<Engine>(initial?.engine ?? 'claude')
  const [model, setModel] = useState<string>(initial?.model ?? AGENTS.claude.models[0].v)
  const [permIdx, setPermIdx] = useState<number>(() => {
    if (!initial) return AGENTS.claude.permDefault
    const i = AGENTS[initial.engine].perms.findIndex((p) => p[1] === initial.permission)
    return i >= 0 ? i : AGENTS[initial.engine].permDefault
  })
  // 调度表单态
  const initSched = initial?.schedule
  const [freq, setFreq] = useState<Freq>(initSched ? ({ hourly: '每小时', daily: '每天', weekdays: '工作日', weekly: '每周' } as const)[initSched.kind] : '每天')
  const [weekday, setWeekday] = useState<number>(initSched?.kind === 'weekly' ? initSched.weekday : 1)
  const [time, setTime] = useState<string>(initSched && initSched.kind !== 'hourly' ? initSched.time : initSched?.kind === 'hourly' ? `00:${String(initSched.minute).padStart(2, '0')}` : '09:00')
  const [tz, setTz] = useState<string>(initSched && initSched.kind !== 'hourly' ? initSched.timezone : 'Asia/Shanghai')
  // 目标项目
  const [target, setTarget] = useState<AutomationTarget>(initial?.target ?? { mode: 'create_each_run' })
  const [projQuery, setProjQuery] = useState('')
  // 分类
  const [categories, setCategories] = useState<string[]>(initial?.categories ?? prefill?.categories ?? [])
  const [newTag, setNewTag] = useState('')
  const tagPool = useMemo(() => Array.from(new Set([...knownCategories, ...categories])), [knownCategories, categories])

  const [openPop, setOpenPop] = useState<Pop>(null)
  const [busy, setBusy] = useState(false)
  const titleRef = useRef<HTMLInputElement>(null)

  useEffect(() => { setTimeout(() => titleRef.current?.focus(), 30) }, [])
  // 点空白处（不在任何 .auto-pill 内）关弹层；Esc 关弹层或关弹窗
  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('.auto-pill')) setOpenPop(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (openPop) setOpenPop(null); else onClose() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [openPop, onClose])

  const agent = AGENTS[engine]
  const isRisky = permIdx === agent.permDefault   // 最宽档（bypass / 完全访问）→ 风险提示
  const engLabel = `${agent.label} · ${agent.models.find((m) => m.v === model)?.l ?? model} · ${agent.perms[permIdx][0]}`

  const schedule = useMemo<AutomationSchedule>(() => {
    if (freq === '每小时') return { kind: 'hourly', minute: Number(time.split(':')[1] || 0) }
    if (freq === '工作日') return { kind: 'weekdays', time, timezone: tz }
    if (freq === '每周') return { kind: 'weekly', time, timezone: tz, weekday }
    return { kind: 'daily', time, timezone: tz }
  }, [freq, time, tz, weekday])

  const projLabel = target.mode === 'create_each_run' ? '每次新建项目' : (projects.find((p) => p.id === target.projectId)?.name ?? '复用项目')
  const filteredProjects = projects.filter((p) => p.name.toLowerCase().includes(projQuery.trim().toLowerCase()))

  const pickEngine = (e: Engine) => { setEngine(e); setModel(AGENTS[e].models[0].v); setPermIdx(AGENTS[e].permDefault) }
  const toggleTag = (t: string) => setCategories((cs) => cs.includes(t) ? cs.filter((x) => x !== t) : [...cs, t])
  const addNewTag = () => { const v = newTag.trim(); if (!v) return; if (!categories.includes(v)) setCategories((cs) => [...cs, v]); setNewTag('') }

  const canSubmit = title.trim() && prompt.trim() && !busy

  const submit = async () => {
    if (!canSubmit) return
    setBusy(true)
    const body = {
      name: title.trim(), prompt: prompt.trim(), engine, model,
      permission: agent.perms[permIdx][1], categories, schedule, target,
    }
    try {
      if (initial) await api.patchAutomation(initial.id, body)
      else await api.createAutomation({ ...body, enabled: true })
      onSaved()
    } catch { setBusy(false) }   // 失败留在弹窗，便于重试
  }

  const togglePop = (p: Pop) => setOpenPop((cur) => (cur === p ? null : p))

  return (
    <div className="automation-modal-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="automation-modal" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <header className="automation-modal__head">
          <input ref={titleRef} className="automation-modal__title-input" placeholder="自动化标题" value={title} onChange={(e) => setTitle(e.target.value)} />
          <div className="automation-modal__head-actions">
            <button type="button" className="automation-modal__close" onClick={onClose} aria-label="关闭">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </header>
        <div className="automation-modal__body">
          <textarea className="automation-modal__prompt" placeholder="描述要让 agent 在这个排期上无人值守做什么……" value={prompt} onChange={(e) => setPrompt(e.target.value)} />
        </div>
        <footer className="automation-modal__foot">
          <div className="automation-modal__pills">
            {/* 引擎·模型·权限一体 */}
            <div className="auto-pill" onClick={(e) => { if (!(e.target as HTMLElement).closest('.auto-pop')) togglePop('eng') }}>
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 10l3.5 4L8 18" /><path d="M14 18h4" /></svg></span>
              <span>{engLabel}</span><span className="psep">⌄</span>
              <div className={`auto-pop${openPop === 'eng' ? ' open' : ''}`} style={{ width: 292, maxHeight: 'min(62vh,440px)', overflow: 'auto' }}>
                <div className="auto-pop__row">
                  <div className="auto-pop__label">引擎</div>
                  <div className="auto-pop__freq" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
                    {(['claude', 'codex'] as Engine[]).map((e) => (
                      <button key={e} type="button" className={engine === e ? 'on' : ''} onClick={() => pickEngine(e)}>{AGENTS[e].label}</button>
                    ))}
                  </div>
                </div>
                <div className="auto-pop__label" style={{ marginTop: 2 }}>模型</div>
                <div>
                  {agent.models.map((m) => (
                    <div key={m.v} className={`auto-pop__item${m.v === model ? ' sel' : ''}`} onClick={() => setModel(m.v)}><span className="t">{m.l}</span></div>
                  ))}
                </div>
                <div className="auto-pop__label" style={{ marginTop: 6 }}>权限档 · 无人值守时生效</div>
                <div>
                  {agent.perms.map(([zh, en], i) => (
                    <div key={en} className={`auto-pop__item${i === permIdx ? ' sel' : ''}`} onClick={() => setPermIdx(i)}><span className="t">{zh}</span><span className="h">{en}</span></div>
                  ))}
                </div>
                {isRisky && (
                  <div style={{ fontSize: 11, color: 'var(--amber)', background: 'var(--amber-bg)', borderRadius: 7, padding: '6px 9px', lineHeight: 1.45, marginTop: 2 }}>
                    ⚠ 无人值守下可执行任意命令（含删除 / 联网），没人盯着。仅在信任该任务时用，否则调低档位。
                  </div>
                )}
              </div>
            </div>
            {/* 调度 */}
            <div className="auto-pill" onClick={(e) => { if (!(e.target as HTMLElement).closest('.auto-pop')) togglePop('sched') }}>
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              <span>{scheduleSummary(schedule)}</span><span className="psep">⌄</span>
              <div className={`auto-pop${openPop === 'sched' ? ' open' : ''}`} style={{ width: 288 }}>
                <div className="auto-pop__row">
                  <div className="auto-pop__label">频率</div>
                  <div className="auto-pop__freq" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                    {(['每小时', '每天', '工作日', '每周'] as Freq[]).map((f) => (
                      <button key={f} type="button" className={freq === f ? 'on' : ''} onClick={() => setFreq(f)}>{f}</button>
                    ))}
                  </div>
                </div>
                {freq === '每周' && (
                  <div className="auto-pop__row">
                    <div className="auto-pop__label">星期</div>
                    <div className="auto-pop__freq" style={{ gridTemplateColumns: 'repeat(7,1fr)' }}>
                      {WEEKDAYS.map((w, i) => (
                        <button key={w} type="button" className={weekday === i ? 'on' : ''} onClick={() => setWeekday(i)}>{w}</button>
                      ))}
                    </div>
                  </div>
                )}
                <div className="auto-pop__row">
                  <div className="auto-pop__label">{freq === '每小时' ? '分钟（取 mm）' : '时间'}</div>
                  <input className="field-input" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
                </div>
                {freq !== '每小时' && (
                  <div className="auto-pop__row">
                    <div className="auto-pop__label">时区</div>
                    <select className="field-select" value={tz} onChange={(e) => setTz(e.target.value)}>
                      {TZ_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                    </select>
                  </div>
                )}
                <div className="auto-pop__done"><button type="button" onClick={() => setOpenPop(null)}>完成</button></div>
              </div>
            </div>
            {/* 目标项目 */}
            <div className="auto-pill" onClick={(e) => { if (!(e.target as HTMLElement).closest('.auto-pop')) togglePop('proj') }}>
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg></span>
              <span>{projLabel}</span><span className="psep">⌄</span>
              <div className={`auto-pop${openPop === 'proj' ? ' open' : ''}`} style={{ width: 268 }}>
                <div className="auto-pop__label">目标项目</div>
                <div className={`auto-pop__item${target.mode === 'create_each_run' ? ' sel' : ''}`} onClick={() => { setTarget({ mode: 'create_each_run' }); setOpenPop(null) }}>
                  <span className="t">每次新建项目</span><span className="h">每次运行都开一个全新项目与会话。</span>
                </div>
                <input className="field-input" placeholder="搜索已有项目…" style={{ marginTop: 2 }} value={projQuery} onChange={(e) => setProjQuery(e.target.value)} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 184, overflow: 'auto' }}>
                  {filteredProjects.map((p) => (
                    <div key={p.id} className={`auto-pop__item${target.mode === 'reuse' && target.projectId === p.id ? ' sel' : ''}`} onClick={() => { setTarget({ mode: 'reuse', projectId: p.id }); setOpenPop(null) }}>
                      <span className="t">{p.name}</span>
                    </div>
                  ))}
                  {filteredProjects.length === 0 && <div className="auto-pop__label" style={{ padding: '6px 2px' }}>没有匹配的项目</div>}
                </div>
              </div>
            </div>
            {/* 分类 */}
            <div className="auto-pill" onClick={(e) => { if (!(e.target as HTMLElement).closest('.auto-pop')) togglePop('tag') }}>
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12l-8 8-9-9V3h8z" /><circle cx="7" cy="7" r="1.6" /></svg></span>
              <span>{categories.length ? categories.join(' · ') : '分类'}</span><span className="psep">⌄</span>
              <div className={`auto-pop${openPop === 'tag' ? ' open' : ''}`} style={{ width: 236 }}>
                <div className="auto-pop__label">分类 · 可多选（用于筛选/分组）</div>
                <div className="tag-pick">
                  {tagPool.map((t) => (
                    <span key={t} className={`auto-tag${categories.includes(t) ? ' on' : ''}`} onClick={() => toggleTag(t)}>{t}</span>
                  ))}
                </div>
                <input className="field-input" placeholder="新分类，回车添加" style={{ marginTop: 2 }} value={newTag}
                  onChange={(e) => setNewTag(e.target.value)}
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewTag() } }} />
              </div>
            </div>
          </div>
          <div className="automation-modal__actions">
            <button type="button" className="automation-modal__cancel" onClick={onClose}>取消</button>
            <button type="submit" className="automation-modal__submit" disabled={!canSubmit}>{initial ? '保存' : '创建'}</button>
          </div>
        </footer>
      </form>
    </div>
  )
}
