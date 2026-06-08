// 自动任务「设置」弹窗（agent-led 后：内容/提示词归 agent，此弹窗只设结构化字段）。
// 视觉/交互对齐原型开发版 tasks.html：pill 弹层、点空白关、互斥。Plan D D3。
import { useEffect, useMemo, useRef, useState } from 'react'
import type { AutomationDTO, AutomationTarget, AutomationTriggerDef, Engine, ProjectDTO, ReqSlot, SecretView, CatNode } from '../api/types'
import { triggerSummary, formToDef, type Freq, type TimeTriggerForm } from './triggers'
import { walk } from './categoryTree'
import { api } from '../api/client'

// 引擎 → 模型 + 权限档（claude 5 档 / codex 沙箱 3 档）。模型用 app 真实别名。
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

type Pop = 'eng' | 'trig' | 'exec' | 'proj' | 'cat' | 'tag' | null

export interface AutomationSettingsModalProps {
  automation: AutomationDTO          // 必传：设置永远针对已存在的任务（新建走 agent-led）
  projects: ProjectDTO[]
  categoryTree: CatNode[]            // 来自 D6 端点
  onOpenCategoryManager: () => void  // 弹「管理分类」模态
  onClose: () => void
  onSaved: () => void
}

export function AutomationSettingsModal({ automation, projects, categoryTree, onOpenCategoryManager, onClose, onSaved }: AutomationSettingsModalProps) {
  const [engine, setEngine] = useState<Engine>(automation.engine)
  const [model, setModel] = useState<string>(automation.model)
  const [permIdx, setPermIdx] = useState<number>(() => {
    const i = AGENTS[automation.engine].perms.findIndex((p) => p[1] === automation.permission)
    return i >= 0 ? i : AGENTS[automation.engine].permDefault
  })
  const [triggers, setTriggers] = useState<AutomationTriggerDef[]>(automation.triggers)
  const [executor, setExecutor] = useState<'agent' | 'script'>(automation.executor)
  const [script, setScript] = useState<string>(automation.script ?? '')
  const [category, setCategory] = useState<string[]>(automation.category)
  const [tags, setTags] = useState<Set<string>>(new Set(automation.tags))
  const [newTag, setNewTag] = useState('')
  const [target, setTarget] = useState<AutomationTarget>(automation.target)
  const [projQuery, setProjQuery] = useState('')
  // 时间触发器编辑器表单态（加一条时间触发用）
  const [tForm, setTForm] = useState<TimeTriggerForm>({ freq: '每天', time: '09:00', tz: 'Asia/Shanghai', weekday: 1 })

  // 配置区：env 声明（automation.requires）+ 命名密钥 + 现有绑定
  const [secrets, setSecrets] = useState<SecretView[]>([])
  const [slots, setSlots] = useState<ReqSlot[]>([])
  const entityRef = `automation:${automation.id}`

  const [openPop, setOpenPop] = useState<Pop>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    void (async () => {
      const [sec, reqs] = await Promise.all([api.listSecrets(), api.listEntityRequirements()])
      setSecrets(sec.secrets)
      const existing = reqs.requirements[entityRef]?.slots ?? []
      const bindOf = (name: string) => existing.find((s) => s.kind === 'env' && s.name === name)?.bind ?? null
      // 声明来自 frontmatter requires（env），绑定从已存的 entity-requirements 取
      setSlots(automation.requires.filter((r) => r.kind === 'env').map((r) => ({ kind: 'env' as const, name: r.name, bind: bindOf(r.name), optional: false })))
    })()
  }, [entityRef, automation.requires])

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest?.('.auto-pill')) setOpenPop(null) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { if (openPop) setOpenPop(null); else onClose() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [openPop, onClose])

  const agent = AGENTS[engine]
  const isRisky = permIdx === agent.permDefault
  const engLabel = `${agent.label} · ${agent.models.find((m) => m.v === model)?.l ?? model} · ${agent.perms[permIdx][0]}`
  const trigLabel = triggers.length ? triggers.map(triggerSummary).join(' · ') : '未设触发器'
  const execLabel = executor === 'script' ? `脚本：${script || '未设入口'}` : 'Agent 执行'
  const catLabel = category.length ? category.join(' › ') : '未分类'
  const projLabel = target.mode === 'create_each_run' ? '每次新建项目' : (projects.find((p) => p.id === target.projectId)?.name ?? '复用项目')
  const filteredProjects = projects.filter((p) => p.name.toLowerCase().includes(projQuery.trim().toLowerCase()))
  const tagPool = useMemo(() => Array.from(new Set([...automation.tags, ...tags])), [automation.tags, tags])

  const pickEngine = (e: Engine) => { setEngine(e); setModel(AGENTS[e].models[0].v); setPermIdx(AGENTS[e].permDefault) }
  const addStartup = () => { if (!triggers.some((t) => t.kind === 'startup')) setTriggers((ts) => [...ts, { kind: 'startup' }]) }
  const addTimeTrigger = () => setTriggers((ts) => [...ts, formToDef(tForm)])
  const removeTrigger = (i: number) => setTriggers((ts) => ts.filter((_, j) => j !== i))
  const toggleTag = (t: string) => setTags((s) => { const n = new Set(s); n.has(t) ? n.delete(t) : n.add(t); return n })
  const addNewTag = () => { const v = newTag.trim(); if (v) setTags((s) => new Set(s).add(v)); setNewTag('') }
  const bindSlot = (name: string, secretId: string | null) => setSlots((ss) => ss.map((s) => s.name === name ? { ...s, bind: secretId } : s))
  const togglePop = (p: Pop) => setOpenPop((cur) => (cur === p ? null : p))

  const submit = async () => {
    if (busy) return
    setBusy(true)
    const body = {
      name: automation.name, description: automation.description,
      engine, model, permission: agent.perms[permIdx][1],
      category, tags: [...tags], triggers, executor, ...(executor === 'script' ? { script } : {}),
      target,
    }
    try {
      await api.patchAutomation(automation.id, body)
      // 配置绑定单独落库（声明来自 frontmatter，此处只改绑定）
      await api.putEntityRequirements(entityRef, { needsConfig: slots.some((s) => !s.bind && !s.optional), slotsSource: 'declared', slots })
      onSaved()
    } catch { setBusy(false) }
  }

  const pop = (p: Pop, cls = '') => (e: React.MouseEvent) => { if (!(e.target as HTMLElement).closest('.auto-pop')) togglePop(p); void cls }

  return (
    <div className="automation-modal-backdrop open" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className="automation-modal" onSubmit={(e) => { e.preventDefault(); void submit() }}>
        <header className="automation-modal__head">
          <input className="automation-modal__title-input" value={automation.name} readOnly style={{ cursor: 'default' }} />
          <div className="automation-modal__head-actions">
            <button type="button" className="automation-modal__close" onClick={onClose} aria-label="关闭">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </div>
        </header>
        <div className="automation-modal__body">
          <p className="automation-modal__hint" style={{ fontSize: 12, color: 'var(--muted)', lineHeight: 1.5, margin: '0 0 4px' }}>
            这里设置 触发 / 目标 / 分类 / 标签 / 密钥。要改任务做什么请用卡片的「编辑」——交给 agent 改。
          </p>
          {/* 配置区：声明的 env + 绑定命名密钥（来自 requires，无探测按钮） */}
          {slots.length > 0 && (
            <div className="cfg-list">
              <div className="auto-pop__label" style={{ marginBottom: 4 }}>需要的密钥（运行前请绑定）</div>
              {slots.map((s) => (
                <div key={s.name} className="cfg-row" style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 0' }}>
                  <span className="cfg-name" style={{ fontFamily: 'monospace', fontSize: 12 }}>{s.name}</span>
                  <select className="field-select" value={s.bind ?? ''} onChange={(e) => { if (e.target.value === '__new__') void onCreateSecret(s.name); else bindSlot(s.name, e.target.value || null) }}>
                    <option value="">选择密钥…</option>
                    {secrets.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
                    <option value="__new__">+ 新建密钥…</option>
                  </select>
                  <span className={`cfg-badge ${s.bind ? 'cfg-badge--done' : 'cfg-badge--need'}`}>{s.bind ? '已绑定' : '未绑定'}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <footer className="automation-modal__foot">
          <div className="automation-modal__pills">
            {/* 引擎·模型·权限 */}
            <div className="auto-pill" onClick={pop('eng')}>
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M8 10l3.5 4L8 18" /><path d="M14 18h4" /></svg></span>
              <span>{engLabel}</span><span className="psep">⌄</span>
              <div className={`auto-pop${openPop === 'eng' ? ' open' : ''}`} style={{ width: 292, maxHeight: 'min(62vh,440px)', overflow: 'auto' }}>
                <div className="auto-pop__row">
                  <div className="auto-pop__label">引擎</div>
                  <div className="auto-pop__freq" style={{ gridTemplateColumns: 'repeat(2,1fr)' }}>
                    {(['claude', 'codex'] as Engine[]).map((e) => <button key={e} type="button" className={engine === e ? 'on' : ''} onClick={() => pickEngine(e)}>{AGENTS[e].label}</button>)}
                  </div>
                </div>
                <div className="auto-pop__label" style={{ marginTop: 2 }}>模型</div>
                <div>{agent.models.map((m) => <div key={m.v} className={`auto-pop__item${m.v === model ? ' sel' : ''}`} onClick={() => setModel(m.v)}><span className="t">{m.l}</span></div>)}</div>
                <div className="auto-pop__label" style={{ marginTop: 6 }}>权限档 · 无人值守时生效</div>
                <div>{agent.perms.map(([zh, en], i) => <div key={en} className={`auto-pop__item${i === permIdx ? ' sel' : ''}`} onClick={() => setPermIdx(i)}><span className="t">{zh}</span><span className="h">{en}</span></div>)}</div>
                {isRisky && <div style={{ fontSize: 11, color: 'var(--amber)', background: 'var(--amber-bg)', borderRadius: 7, padding: '6px 9px', lineHeight: 1.45, marginTop: 2 }}>⚠ 无人值守下可执行任意命令（含删除 / 联网），没人盯着。仅在信任该任务时用。</div>}
              </div>
            </div>
            {/* 触发器（多触发 + startup） */}
            <div className="auto-pill" onClick={pop('trig')}>
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="9" /><path d="M12 8v4l3 2" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              <span>{trigLabel}</span><span className="psep">⌄</span>
              <div className={`auto-pop${openPop === 'trig' ? ' open' : ''}`} style={{ width: 300 }}>
                <div className="auto-pop__label">触发器 · 可挂多个</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  {triggers.map((t, i) => (
                    <div key={i} className="auto-pop__item" style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span className="t">{triggerSummary(t)}</span>
                      <button type="button" className="trig-del" onClick={() => removeTrigger(i)} aria-label="删除触发器">×</button>
                    </div>
                  ))}
                  {triggers.length === 0 && <div className="auto-pop__label" style={{ padding: '4px 2px' }}>还没有触发器</div>}
                </div>
                <div style={{ display: 'flex', gap: 6, margin: '6px 0' }}>
                  <button type="button" onClick={addStartup}>+ 启动触发</button>
                </div>
                <div className="auto-pop__row">
                  <div className="auto-pop__label">加时间触发</div>
                  <div className="auto-pop__freq" style={{ gridTemplateColumns: 'repeat(4,1fr)' }}>
                    {(['每小时', '每天', '工作日', '每周'] as Freq[]).map((f) => <button key={f} type="button" className={tForm.freq === f ? 'on' : ''} onClick={() => setTForm((s) => ({ ...s, freq: f }))}>{f}</button>)}
                  </div>
                </div>
                {tForm.freq === '每周' && (
                  <div className="auto-pop__row"><div className="auto-pop__label">星期</div>
                    <div className="auto-pop__freq" style={{ gridTemplateColumns: 'repeat(7,1fr)' }}>{WEEKDAYS.map((w, i) => <button key={w} type="button" className={tForm.weekday === i ? 'on' : ''} onClick={() => setTForm((s) => ({ ...s, weekday: i }))}>{w}</button>)}</div>
                  </div>
                )}
                <div className="auto-pop__row"><div className="auto-pop__label">{tForm.freq === '每小时' ? '分钟（取 mm）' : '时间'}</div>
                  <input className="field-input" type="time" value={tForm.time} onChange={(e) => setTForm((s) => ({ ...s, time: e.target.value }))} /></div>
                {tForm.freq !== '每小时' && (
                  <div className="auto-pop__row"><div className="auto-pop__label">时区</div>
                    <select className="field-select" value={tForm.tz} onChange={(e) => setTForm((s) => ({ ...s, tz: e.target.value }))}>{TZ_OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></div>
                )}
                <div className="auto-pop__done"><button type="button" onClick={addTimeTrigger}>添加该触发器</button></div>
              </div>
            </div>
            {/* 执行方式 */}
            <div className="auto-pill" onClick={pop('exec')}>
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 4l14 8-14 8z" /></svg></span>
              <span>{execLabel}</span><span className="psep">⌄</span>
              {openPop === 'exec' && (<div className="auto-pop open" style={{ width: 256 }}>
                <div className="auto-pop__label">执行方式</div>
                <div className={`auto-pop__item${executor === 'agent' ? ' sel' : ''}`} onClick={() => setExecutor('agent')}><span className="t">Agent 执行</span><span className="h">喂引擎跑 prompt，需推理时用</span></div>
                <div className={`auto-pop__item${executor === 'script' ? ' sel' : ''}`} onClick={() => setExecutor('script')}><span className="t">脚本直跑</span><span className="h">不经 LLM，确定性任务用</span></div>
                {executor === 'script' && <div className="auto-pop__row" style={{ marginTop: 4 }}><div className="auto-pop__label">脚本入口</div><input className="field-input" placeholder="scan.mjs" value={script} onChange={(e) => setScript(e.target.value)} /></div>}
              </div>)}
            </div>
            {/* 目标项目 */}
            <div className="auto-pill" onClick={pop('proj')}>
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg></span>
              <span>{projLabel}</span><span className="psep">⌄</span>
              <div className={`auto-pop${openPop === 'proj' ? ' open' : ''}`} style={{ width: 268 }}>
                <div className="auto-pop__label">目标项目</div>
                <div className={`auto-pop__item${target.mode === 'create_each_run' ? ' sel' : ''}`} onClick={() => { setTarget({ mode: 'create_each_run' }); setOpenPop(null) }}><span className="t">每次新建项目</span><span className="h">每次运行都开一个全新项目与会话。</span></div>
                <input className="field-input" placeholder="搜索已有项目…" style={{ marginTop: 2 }} value={projQuery} onChange={(e) => setProjQuery(e.target.value)} />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 1, maxHeight: 184, overflow: 'auto' }}>
                  {filteredProjects.map((p) => <div key={p.id} className={`auto-pop__item${target.mode === 'reuse' && target.projectId === p.id ? ' sel' : ''}`} onClick={() => { setTarget({ mode: 'reuse', projectId: p.id }); setOpenPop(null) }}><span className="t">{p.name}</span></div>)}
                  {filteredProjects.length === 0 && <div className="auto-pop__label" style={{ padding: '6px 2px' }}>没有匹配的项目</div>}
                </div>
              </div>
            </div>
            {/* 分类（层级树单选） */}
            <div className="auto-pill" onClick={pop('cat')}>
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg></span>
              <span>{catLabel}</span><span className="psep">⌄</span>
              <div className={`auto-pop${openPop === 'cat' ? ' open' : ''}`} style={{ width: 248, maxHeight: 'min(54vh,380px)', overflow: 'auto' }}>
                <div className="auto-pop__row" style={{ justifyContent: 'space-between' }}>
                  <div className="auto-pop__label">分类 · 单归属</div>
                  <button type="button" className="cat-mgmt-link" onClick={onOpenCategoryManager}>管理分类…</button>
                </div>
                <div className={`auto-pop__item${category.length === 0 ? ' sel' : ''}`} onClick={() => { setCategory([]); setOpenPop(null) }}><span className="t">未分类</span></div>
                {flatTree(categoryTree).map(({ path, depth }) => (
                  <div key={path.join('/')} className={`auto-pop__item${category.join('/') === path.join('/') ? ' sel' : ''}`} style={{ paddingLeft: depth * 16 + 8 }} onClick={() => { setCategory(path); setOpenPop(null) }}><span className="t">{path[path.length - 1]}</span></div>
                ))}
              </div>
            </div>
            {/* 标签（扁平多选） */}
            <div className="auto-pill" onClick={pop('tag')}>
              <span className="ic"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M20 12l-8 8-9-9V3h8z" /><circle cx="7" cy="7" r="1.6" /></svg></span>
              <span>{tags.size ? [...tags].join(' · ') : '标签'}</span><span className="psep">⌄</span>
              <div className={`auto-pop${openPop === 'tag' ? ' open' : ''}`} style={{ width: 236 }}>
                <div className="auto-pop__label">标签 · 可多选（横切筛选）</div>
                <div className="tag-pick">{tagPool.map((t) => <span key={t} className={`auto-tag${tags.has(t) ? ' on' : ''}`} onClick={() => toggleTag(t)}>{t}</span>)}</div>
                <input className="field-input" placeholder="新标签，回车添加" style={{ marginTop: 2 }} value={newTag} onChange={(e) => setNewTag(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); addNewTag() } }} />
              </div>
            </div>
          </div>
          <div className="automation-modal__actions">
            <button type="button" className="automation-modal__cancel" onClick={onClose}>取消</button>
            <button type="submit" className="automation-modal__submit" disabled={busy}>保存设置</button>
          </div>
        </footer>
      </form>
    </div>
  )

  async function onCreateSecret(slotName: string) {
    const name = window.prompt(`为 ${slotName} 新建命名密钥（名称）：`)
    if (!name?.trim()) return
    const value = window.prompt('密钥值：') ?? ''
    const { secret } = await api.createSecret({ name: name.trim(), value })
    const sec = await api.listSecrets(); setSecrets(sec.secrets)
    bindSlot(slotName, secret.id)
  }
}

/** 把分类树拍平成 {path, depth} 序列（深度优先），供弹层缩进渲染。 */
function flatTree(tree: CatNode[]): { path: string[]; depth: number }[] {
  const out: { path: string[]; depth: number }[] = []
  walk(tree, (_n, path, depth) => out.push({ path, depth }))
  return out
}
