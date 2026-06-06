import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Engine, GitProvider, ProbedSkill, SkillSourceDef, UpdateMode } from '../api/types'
import { AddSourceModal } from './AddSourceModal'
import { SkillMdModal } from './SkillMdModal'

const LIB = '__lib__'

// ── icons (1:1 from prototype ICON object, integrations.html L247-256) ───────
const IconFolder = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /></svg>
)
const IconGit = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-1.7c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" /></svg>
)
const IconGitAlt = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M6 3v12" /><circle cx="18" cy="6" r="3" /><circle cx="6" cy="18" r="3" /><path d="M18 9a9 9 0 0 1-9 9" /></svg>
)
const IconMarket = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round"><path d="M3 9l1.5-5h15L21 9M3 9v10a1 1 0 0 0 1 1h16a1 1 0 0 0 1-1V9M3 9h18M8 9v4M16 9v4" /></svg>
)
const IconLib = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round"><path d="M12 2 2 7l10 5 10-5-10-5z" /><path d="M2 17l10 5 10-5" /><path d="M2 12l10 5 10-5" /></svg>
)
const IconLock = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinejoin="round"><rect x="4" y="11" width="16" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
)
const IconHandle = () => (
  <svg width="12" height="16" viewBox="0 0 12 16" fill="currentColor"><circle cx="3.5" cy="3" r="1.4" /><circle cx="8.5" cy="3" r="1.4" /><circle cx="3.5" cy="8" r="1.4" /><circle cx="8.5" cy="8" r="1.4" /><circle cx="3.5" cy="13" r="1.4" /><circle cx="8.5" cy="13" r="1.4" /></svg>
)
const IconRefresh = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-3-6.7L21 8" /><path d="M21 3v5h-5" /></svg>
)
const IconPencil = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z" /></svg>
)
const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
)
const IconChevDown = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" style={{ marginLeft: 1 }}><polyline points="6 9 12 15 18 9" /></svg>
)
const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
)

// ── labels (1:1 from prototype) ──────────────────────────────────────────────
const PROVIDER_LABEL: Record<GitProvider, string> = { github: 'GitHub', gitee: '码云', cnb: 'CNB', gitlab: 'GitLab', other: 'Git' }
const MODE_DESC: Record<UpdateMode, string> = {
  manual: '上游有新版本只提示，需手动「重新探测」拉取；是否入库由你决定。',
  auto: '源有新版本时自动拉取并重新探测；新技能不会自动入库，由你挑选。',
  autolib: '源有新版本时自动拉取并重新探测，新技能自动加入技能库（整源托管）。',
}

function typeLabel(s: SkillSourceDef): string {
  if (s.type === 'folder') return '本地'
  if (s.type === 'market') return '市场'
  return PROVIDER_LABEL[s.provider ?? 'github']
}

/** 源图标：folder → 文件夹；market → 集市；git → github 用实心 logo，其余 provider 用 alt 线性图 + provider 配色 */
function SrcIcon({ s }: { s: SkillSourceDef }) {
  let cls = ''
  let svg = <IconFolder />
  if (s.type === 'market') { cls = 'src-ic--market'; svg = <IconMarket /> }
  else if (s.type === 'git') {
    const p = s.provider ?? 'github'
    if (p === 'github') { cls = 'src-ic--git'; svg = <IconGit /> }
    else { cls = `src-ic--${p}`; svg = <IconGitAlt /> }
  }
  return <span className={`src-ic ${cls}`}>{svg}</span>
}

const matchSkill = (k: ProbedSkill, q: string) =>
  !q || k.name.toLowerCase().includes(q) || (k.desc || '').toLowerCase().includes(q) || (k.relPath || '').toLowerCase().includes(q)

/** 全局引擎同名 = 覆盖预警（个人级 > 项目级，注入会被覆盖） */
function ShadowBadge({ skill }: { skill: ProbedSkill }) {
  if (!skill.globalIn || skill.globalIn.length === 0) return null
  const names = skill.globalIn.map((e: Engine) => (e === 'claude' ? 'Claude' : 'Codex')).join('·')
  return (
    <span className="si-shadow" title={`全局 ${names} 技能里已有同名，会覆盖注入的这个（个人级 > 项目级），注入将不生效`}>
      ⚠ {names} 全局
    </span>
  )
}

// ── SkillRow（si-row）：库视图用 si-src，源详情用 si-path ──────────────────────
interface SkillRowProps {
  skill: ProbedSkill
  variant: 'lib' | 'source'
  sourceName?: string
  isDup: boolean
  onClick: () => void
}
function SkillRow({ skill, variant, sourceName, isDup, onClick }: SkillRowProps) {
  return (
    <button className={`si-row${skill.inLib ? ' on' : ''}`} type="button" onClick={onClick}>
      <span className="si-main">
        <span className="si-name">
          {skill.name}
          {variant === 'lib'
            ? <span className="si-src">{sourceName}</span>
            : <span className="si-path">{skill.relPath}</span>}
          {skill.inLib && isDup && <span className="si-dup" title="库里有同名技能，按源区分共存">重名</span>}
          <ShadowBadge skill={skill} />
        </span>
        <span className="si-desc">{skill.desc}</span>
      </span>
      {skill.inLib && <span className="si-check" title="已在技能库">✓</span>}
    </button>
  )
}

// ── add-source dropdown menu ─────────────────────────────────────────────────
function AddSourceMenu({ onPick }: { onPick: (kind: 'folder' | 'git' | 'market') => void }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])
  return (
    <div className="src-add">
      <button className="skill-new" type="button" onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}>
        <IconPlus />添加源<IconChevDown />
      </button>
      <div className={`src-add-menu${open ? ' open' : ''}`}>
        <button type="button" onClick={() => { setOpen(false); onPick('folder') }}>
          <span className="sam-ic"><IconFolder /></span>
          <span className="sam-main"><span className="sam-t">本地文件夹</span><span className="sam-d">探测文件夹内的 SKILL.md</span></span>
        </button>
        <button type="button" onClick={() => { setOpen(false); onPick('git') }}>
          <span className="sam-ic"><IconGit /></span>
          <span className="sam-main"><span className="sam-t">GitHub 项目</span><span className="sam-d">克隆仓库并探测，支持私有库</span></span>
        </button>
        <button type="button" onClick={() => { setOpen(false); onPick('market') }}>
          <span className="sam-ic"><IconMarket /></span>
          <span className="sam-main"><span className="sam-t">技能市场<span className="src-badge src-badge--soon" style={{ marginLeft: 6 }}>即将上线</span></span><span className="sam-d">从社区注册表浏览并安装</span></span>
        </button>
      </div>
    </div>
  )
}

// ── search bar ───────────────────────────────────────────────────────────────
function SkillSearch({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="src-skill-search">
      <IconSearch />
      <input value={value} placeholder="搜索技能…" autoComplete="off" onChange={e => onChange(e.target.value)} />
    </div>
  )
}

// ── main component ───────────────────────────────────────────────────────────
export function SkillsSettings() {
  const [sources, setSources] = useState<SkillSourceDef[]>([])
  const [probesBySource, setProbesBySource] = useState<Record<string, ProbedSkill[]>>({})
  const [selected, setSelected] = useState<string>(LIB)
  const [skillQ, setSkillQ] = useState('')
  const [libFilter, setLibFilter] = useState<'in' | 'out' | 'all'>('in')
  const [loading, setLoading] = useState(true)
  const [reprobing, setReprobing] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')

  const [addSource, setAddSource] = useState<{ kind: 'folder' | 'git'; existing: SkillSourceDef | null } | null>(null)
  const [skillMd, setSkillMd] = useState<{ source: SkillSourceDef; skill: ProbedSkill } | null>(null)

  // 拖拽排序：本地态即时重排，dragend 落库
  const dragId = useRef<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const { sources: list } = await api.listSkillSources()
      setSources(list)
      const entries = await Promise.all(
        list.map(async (s) => {
          try {
            const { skills } = await api.probeSkillSource(s.id)
            return [s.id, skills] as const
          } catch {
            return [s.id, [] as ProbedSkill[]] as const // 源探测失败（如文件夹已不存在）→ 空，不崩页
          }
        })
      )
      setProbesBySource(Object.fromEntries(entries))
    } catch {
      setSources([])
      setProbesBySource({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  // ── derived ──
  const probesOf = useCallback((sid: string): ProbedSkill[] => probesBySource[sid] ?? [], [probesBySource])
  const inLibCount = useCallback((sid: string) => probesOf(sid).filter(k => k.inLib).length, [probesOf])
  const totalInLib = useMemo(
    () => sources.reduce((n, s) => n + (s.type === 'market' ? 0 : inLibCount(s.id)), 0),
    [sources, inLibCount]
  )

  // 全部源里「已入库」的技能（带源名），用于跨源同名预警 + 库视图重名标
  const allInLib = useMemo(() => {
    const out: { name: string; sourceName: string }[] = []
    sources.forEach(s => {
      if (s.type === 'market') return
      probesOf(s.id).forEach(k => { if (k.inLib) out.push({ name: k.name, sourceName: s.name }) })
    })
    return out
  }, [sources, probesOf])

  // 库内出现 ≥2 次的技能名（不同源同名）→ 才按源区分共存
  const dupNames = useMemo(() => {
    const cnt: Record<string, number> = {}
    allInLib.forEach(it => { cnt[it.name] = (cnt[it.name] || 0) + 1 })
    return new Set(Object.keys(cnt).filter(n => cnt[n] >= 2))
  }, [allInLib])

  // 全部探测到的技能（跨源），带源名
  const allItems = useMemo(() => {
    const out: { source: SkillSourceDef; skill: ProbedSkill }[] = []
    sources.forEach(s => {
      if (s.type === 'market') return
      probesOf(s.id).forEach(k => out.push({ source: s, skill: k }))
    })
    return out
  }, [sources, probesOf])

  // ── mutations ──
  const openSkill = (source: SkillSourceDef, skill: ProbedSkill) => setSkillMd({ source, skill })

  const handleMode = async (mode: UpdateMode, s: SkillSourceDef) => {
    try {
      await api.setSourceUpdateMode(s.id, mode)
      await reload()
    } catch { /* keep state on failure */ }
  }

  const handleBulk = async (on: boolean, s: SkillSourceDef) => {
    const targets = probesOf(s.id).filter(k => k.inLib !== on)
    await Promise.all(targets.map(k =>
      api.toggleSkillLib({ sourceId: s.id, relPath: k.relPath, inLib: on }).catch(() => null)))
    await reload()
  }

  const handleReprobe = async (s: SkillSourceDef) => {
    setReprobing(true)
    try {
      const { skills } = await api.reprobeSkillSource(s.id)
      setProbesBySource(prev => ({ ...prev, [s.id]: skills }))
    } catch { /* keep */ } finally {
      setReprobing(false)
    }
  }

  const handleDelete = async (s: SkillSourceDef) => {
    try { await api.removeSkillSource(s.id) } catch { /* */ }
    setSelected(LIB)
    await reload()
  }

  const startRename = (s: SkillSourceDef) => { setRenameVal(s.name); setRenaming(true) }
  const commitRename = async (s: SkillSourceDef) => {
    if (!renaming) return
    setRenaming(false)
    const v = renameVal.trim()
    if (!v || v === s.name) return
    try { await api.patchSkillSource(s.id, { name: v }); await reload() } catch { /* */ }
  }

  const handleReorderEnd = async () => {
    dragId.current = null
    try { await api.reorderSkillSources(sources.map(s => s.id)) } catch { /* best-effort */ }
  }
  const handleDragOver = (overId: string) => {
    const from = dragId.current
    if (from == null || from === overId) return
    setSources(prev => {
      const fi = prev.findIndex(x => x.id === from)
      const ti = prev.findIndex(x => x.id === overId)
      if (fi < 0 || ti < 0) return prev
      const next = prev.slice()
      const [moved] = next.splice(fi, 1)
      next.splice(ti, 0, moved)
      return next
    })
  }

  const onPickAdd = (kind: 'folder' | 'git' | 'market') => {
    if (kind === 'market') return // 技能市场即将上线，no-op（不创建/持久化市场源）
    setAddSource({ kind, existing: null })
  }

  const selSource = selected === LIB ? null : sources.find(s => s.id === selected) ?? null

  // ── render: left column ──
  const leftCol = (
    <div className="src-col">
      <div className="src-lib">
        <button
          className={`src-row src-row--lib${selected === LIB ? ' on' : ''}`}
          type="button"
          onClick={() => setSelected(LIB)}
        >
          <span className="src-ic src-ic--lib"><IconLib /></span>
          <div className="src-row-main">
            <div className="src-row-top"><span className="src-name">技能库</span></div>
            <div className="src-row-sub">已加入 {totalInLib} 个技能</div>
          </div>
        </button>
      </div>
      <div className="src-col-head">
        <div className="lab2">技能源</div>
        <AddSourceMenu onPick={onPickAdd} />
      </div>
      <div className="src-list">
        {sources.map(s => (
          <div
            key={s.id}
            className={`src-row${s.id === selected ? ' on' : ''}`}
            data-id={s.id}
            draggable
            onClick={() => setSelected(s.id)}
            onDragStart={() => { dragId.current = s.id }}
            onDragEnd={handleReorderEnd}
            onDragOver={(e) => { e.preventDefault(); handleDragOver(s.id) }}
          >
            <span className="src-handle" title="拖动排序"><IconHandle /></span>
            <SrcIcon s={s} />
            <div className="src-row-main">
              <div className="src-row-top">
                <span className="src-name">{s.name}</span>
                {s.private && <span className="src-badge src-badge--priv"><IconLock />私有</span>}
              </div>
              <div className="src-row-sub">
                {typeLabel(s)} · {probesOf(s.id).length} 技能 · 已加入 {inLibCount(s.id)}
              </div>
            </div>
          </div>
        ))}
        {!loading && sources.length === 0 && (
          <div className="sm-empty">还没有技能源 —— 点「添加源」注册一个</div>
        )}
      </div>
    </div>
  )

  // ── render: right detail (library view) ──
  const libView = () => {
    const inN = allItems.filter(it => it.skill.inLib).length
    const outN = allItems.length - inN
    const srcN = new Set(allItems.filter(it => it.skill.inLib).map(it => it.source.id)).size
    let list = allItems
    if (libFilter === 'in') list = list.filter(it => it.skill.inLib)
    else if (libFilter === 'out') list = list.filter(it => !it.skill.inLib)
    list = list.filter(it => matchSkill(it.skill, skillQ))
    return (
      <>
        <div className="src-d-head">
          <span className="src-ic src-ic--lib" style={{ width: 40, height: 40, borderRadius: 10 }}><IconLib /></span>
          <div className="src-d-title">
            <div className="src-d-name">技能库</div>
            <div className="src-d-loc">各源中已勾选加入的技能合集 · 点技能看 SKILL.md 并决定是否加入</div>
          </div>
        </div>
        <div className="src-d-summary" style={{ marginTop: 16 }}>
          <span className="src-d-count">已入库 <b>{inN}</b> · 未入库 <b>{outN}</b> · 来自 <b>{srcN}</b> 个源</span>
        </div>
        <div className="lib-filter">
          <button className={`lib-filter-btn${libFilter === 'in' ? ' on' : ''}`} type="button" onClick={() => setLibFilter('in')}>已入库 {inN}</button>
          <button className={`lib-filter-btn${libFilter === 'out' ? ' on' : ''}`} type="button" onClick={() => setLibFilter('out')}>未入库 {outN}</button>
          <button className={`lib-filter-btn${libFilter === 'all' ? ' on' : ''}`} type="button" onClick={() => setLibFilter('all')}>全部 {allItems.length}</button>
        </div>
        <SkillSearch value={skillQ} onChange={setSkillQ} />
        <div className="src-skills" style={{ marginTop: 6 }}>
          {list.length === 0 ? (
            <div className="sm-empty">
              {skillQ ? '没有匹配的技能' : libFilter === 'out' ? '探测到的技能都已入库' : libFilter === 'in' ? '技能库为空 —— 切到「未入库」挑选技能加入' : '没有技能'}
            </div>
          ) : list.map(it => (
            <SkillRow
              key={`${it.source.id}:${it.skill.relPath}`}
              skill={it.skill}
              variant="lib"
              sourceName={it.source.name}
              isDup={dupNames.has(it.skill.name)}
              onClick={() => openSkill(it.source, it.skill)}
            />
          ))}
        </div>
      </>
    )
  }

  return (
    <>
      <p className="set-kicker">设置</p>
      <h2 className="set-h">技能</h2>
      <p className="set-sub">注册技能来源，自动探测其中的 SKILL.md，挑选需要的技能加入技能库。某次任务真正生效的，由发送时的「注入技能」决定。</p>

      <div className="src-layout">
        {leftCol}
        <div className="src-detail">
          {selected === LIB
            ? libView()
            : selSource
              ? <SourceDetail
                  s={selSource}
                  probes={probesOf(selSource.id)}
                  inLibN={inLibCount(selSource.id)}
                  skillQ={skillQ}
                  setSkillQ={setSkillQ}
                  dupNames={dupNames}
                  reprobing={reprobing}
                  renaming={renaming}
                  renameVal={renameVal}
                  setRenameVal={setRenameVal}
                  onStartRename={() => startRename(selSource)}
                  onCommitRename={() => commitRename(selSource)}
                  onCancelRename={() => setRenaming(false)}
                  onMode={(mode) => handleMode(mode, selSource)}
                  onBulk={(on) => handleBulk(on, selSource)}
                  onReprobe={() => handleReprobe(selSource)}
                  onEdit={() => setAddSource({ kind: selSource.type === 'git' ? 'git' : 'folder', existing: selSource })}
                  onDelete={() => handleDelete(selSource)}
                  onOpenSkill={(k) => openSkill(selSource, k)}
                />
              : <div className="src-detail-empty">从左侧选择一个源查看其技能</div>}
        </div>
      </div>

      {addSource && (
        <AddSourceModal
          kind={addSource.kind}
          existing={addSource.existing}
          onSaved={(saved) => { setAddSource(null); setSelected(saved.id); void reload() }}
          onClose={() => setAddSource(null)}
        />
      )}
      {skillMd && (
        <SkillMdModal
          source={skillMd.source}
          skill={skillMd.skill}
          allInLibSkills={allInLib}
          onToggled={() => { void reload() }}
          onClose={() => setSkillMd(null)}
        />
      )}
    </>
  )
}

// ── SourceDetail（单独抽出，避免 main 体过长 + 重命名输入的本地 ref）──────────
interface SourceDetailProps {
  s: SkillSourceDef
  probes: ProbedSkill[]
  inLibN: number
  skillQ: string
  setSkillQ: (v: string) => void
  dupNames: Set<string>
  reprobing: boolean
  renaming: boolean
  renameVal: string
  setRenameVal: (v: string) => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelRename: () => void
  onMode: (mode: UpdateMode) => void
  onBulk: (on: boolean) => void
  onReprobe: () => void
  onEdit: () => void
  onDelete: () => void
  onOpenSkill: (k: ProbedSkill) => void
}

function SourceDetail(p: SourceDetailProps) {
  const { s } = p
  const mode = s.updateMode ?? 'manual'
  const list = p.probes.filter(k => matchSkill(k, p.skillQ))
  return (
    <>
      <div className="src-d-head">
        <span className={`src-ic ${srcIcCls(s)}`} style={{ width: 40, height: 40, borderRadius: 10 }}>
          <SrcIconSvg s={s} />
        </span>
        <div className="src-d-title">
          <div className="src-d-name">
            {p.renaming ? (
              <input
                className="src-d-name-input"
                autoFocus
                value={p.renameVal}
                onChange={e => p.setRenameVal(e.target.value)}
                onKeyDown={e => {
                  if (e.key === 'Enter') { e.preventDefault(); p.onCommitRename() }
                  else if (e.key === 'Escape') { e.stopPropagation(); p.onCancelRename() }
                }}
                onBlur={p.onCommitRename}
              />
            ) : (
              <span className="src-d-name-text">{s.name}</span>
            )}
            {s.private && <span className="src-badge src-badge--priv"><IconLock />私有</span>}
            {!p.renaming && (
              <button className="src-d-rename" type="button" title="重命名源" onClick={p.onStartRename}><IconPencil /></button>
            )}
          </div>
          <div className="src-d-loc">
            {s.type === 'git' && <span className="src-d-prov">{typeLabel(s)}</span>}
            <code>{s.loc}</code>
            {s.branch && <span>分支 <code>{s.branch}</code></span>}
          </div>
        </div>
        <div className="src-d-actions">
          <button className="src-d-btn" type="button" onClick={p.onReprobe} disabled={p.reprobing}>
            <IconRefresh />{p.reprobing ? '探测中…' : '重新探测'}
          </button>
          <button className="src-d-btn" type="button" onClick={p.onEdit}><IconPencil />编辑</button>
          <button className="src-d-btn src-d-btn--danger" type="button" onClick={p.onDelete}>删除</button>
        </div>
      </div>

      <div className="src-d-opt">
        <div className="src-d-opt-head">
          <div className="lab">更新策略</div>
          <div className="seg-control">
            <button className={mode === 'manual' ? 'on' : ''} type="button" onClick={() => p.onMode('manual')}>手动</button>
            <button className={mode === 'auto' ? 'on' : ''} type="button" onClick={() => p.onMode('auto')}>自动更新</button>
            <button className={mode === 'autolib' ? 'on' : ''} type="button" onClick={() => p.onMode('autolib')}>自动更新+入库</button>
          </div>
        </div>
        <div className="src-d-opt-desc">{MODE_DESC[mode]}</div>
      </div>

      <div className="src-probe-hint">
        探测规则：源根目录有 <code>SKILL.md</code> → 整个目录算 <b>1 个技能</b>；否则向下逐级递归，把含 <code>SKILL.md</code> 的目录各算一个（每条路径遇到第一个即停）。
      </div>

      <div className="src-d-summary">
        <span className="src-d-count">探测到 <b>{p.probes.length}</b> 个技能 · 已加入库 <b>{p.inLibN}</b></span>
        <span className="src-d-bulk">
          <button type="button" onClick={() => p.onBulk(true)}>全选加入</button>
          <button type="button" onClick={() => p.onBulk(false)}>全部移出</button>
        </span>
      </div>

      <SkillSearch value={p.skillQ} onChange={p.setSkillQ} />
      <div className="src-skills">
        {list.length === 0 ? (
          <div className="sm-empty">{p.skillQ ? '没有匹配的技能' : '该源里没有探测到 SKILL.md'}</div>
        ) : list.map(k => (
          <SkillRow
            key={`${s.id}:${k.relPath}`}
            skill={k}
            variant="source"
            isDup={p.dupNames.has(k.name)}
            onClick={() => p.onOpenSkill(k)}
          />
        ))}
      </div>
    </>
  )
}

// 40px head 图标：需要拿到 cls 与 svg 分开渲染（SrcIcon 自带 wrapper，这里要内联控制尺寸）
function srcIcCls(s: SkillSourceDef): string {
  if (s.type === 'market') return 'src-ic--market'
  if (s.type === 'git') {
    const pp = s.provider ?? 'github'
    return pp === 'github' ? 'src-ic--git' : `src-ic--${pp}`
  }
  return ''
}
function SrcIconSvg({ s }: { s: SkillSourceDef }) {
  if (s.type === 'market') return <IconMarket />
  if (s.type === 'git') {
    const pp = s.provider ?? 'github'
    return pp === 'github' ? <IconGit /> : <IconGitAlt />
  }
  return <IconFolder />
}
