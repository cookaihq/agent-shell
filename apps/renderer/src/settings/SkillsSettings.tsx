import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { api } from '../api/client'
import type { Engine, EntityRequirement, GitProvider, LibrarySkill, ProbedSkill, SecretView, SkillGroupDef, SkillSourceDef, UpdateMode } from '../api/types'
import { AddSourceModal } from './AddSourceModal'
import { SkillMdModal } from './SkillMdModal'
import { useSettings } from './SettingsContext'

const LIB = '__lib__'
// 系统单例分组：内置 / 自建，禁止改名/删除/加成员（daemon 403）
const SYSTEM_GROUPS = new Set(['builtin', 'created'])

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
const IconGroup = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round"><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>
)
const IconTrash = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><path d="M3 6h18M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2m2 0v14a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V6" /><path d="M10 11v6M14 11v6" /></svg>
)

// ── labels (1:1 from prototype) ──────────────────────────────────────────────
const PROVIDER_LABEL: Record<GitProvider, string> = { github: 'GitHub', gitee: '码云', cnb: 'CNB', gitlab: 'GitLab', other: 'Git' }

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
  cfgState?: 'need' | 'done' | 'none'
  onClick: () => void
  // 默认注入开关（仅库视图）：autoInject 取自对应 LibrarySkill；undefined → 不渲染开关
  autoInject?: boolean
  onToggleAutoInject?: () => void
}
function SkillRow({ skill, variant, sourceName, isDup, cfgState, onClick, autoInject, onToggleAutoInject }: SkillRowProps) {
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
          {cfgState === 'need' && <span className="cfg-badge cfg-badge--need">需配置</span>}
          {cfgState === 'done' && <span className="cfg-badge cfg-badge--done">已配置</span>}
        </span>
        <span
          className="si-desc"
          title={skill.desc}
          style={{ display: '-webkit-box', WebkitLineClamp: 4, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
        >{skill.desc}</span>
      </span>
      {onToggleAutoInject && (
        // button 内不能嵌 button（非法 DOM）→ 用 span[role=checkbox]；stopPropagation 防冒泡到整行打开弹窗
        <span
          className={`si-autoinject${autoInject ? ' on' : ''}`}
          role="checkbox"
          aria-checked={autoInject ? 'true' : 'false'}
          aria-label="默认注入"
          title="默认注入：新建项目时自动带上这个技能"
          tabIndex={0}
          onClick={(e) => { e.stopPropagation(); onToggleAutoInject() }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onToggleAutoInject() } }}
        >默认注入</span>
      )}
      {skill.inLib && <span className="si-check" title="已在技能库">✓</span>}
    </button>
  )
}

// ── add-member dropdown menu（落点是当前分组：git / 本地文件夹 / 市场即将上线）──
function AddMemberMenu({ onPick }: { onPick: (kind: 'folder' | 'git' | 'market') => void }) {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    if (!open) return
    const close = () => setOpen(false)
    document.addEventListener('click', close)
    return () => document.removeEventListener('click', close)
  }, [open])
  return (
    <div className="src-add src-add--inline">
      <button className="src-d-btn src-d-btn--accent" type="button" onClick={(e) => { e.stopPropagation(); setOpen(v => !v) }}>
        <IconPlus />添加成员<IconChevDown />
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
  const { openSettings } = useSettings()
  const [groups, setGroups] = useState<SkillGroupDef[]>([])
  const [sources, setSources] = useState<SkillSourceDef[]>([])
  const [probesBySource, setProbesBySource] = useState<Record<string, ProbedSkill[]>>({})
  const [secrets, setSecrets] = useState<SecretView[]>([])

  const [selected, setSelected] = useState<string>(LIB)  // LIB 或某分组 id
  const [skillQ, setSkillQ] = useState('')
  const [libFilter, setLibFilter] = useState<'in' | 'out' | 'all' | 'auto'>('in')
  const [groupFilter, setGroupFilter] = useState<'in' | 'out' | 'all'>('all')
  const [loading, setLoading] = useState(true)
  const [reprobingId, setReprobingId] = useState<string | null>(null)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState('')
  const [reqs, setReqs] = useState<Record<string, EntityRequirement>>({})
  const [libSkills, setLibSkills] = useState<LibrarySkill[]>([])

  // 落点分组随源弹窗一起传给 AddSourceModal（新增成员时用）
  const [addSource, setAddSource] = useState<{ kind: 'folder' | 'git'; existing: SkillSourceDef | null; groupId?: string } | null>(null)
  const [skillMd, setSkillMd] = useState<{ source: SkillSourceDef; skill: ProbedSkill } | null>(null)

  // 拖拽排序：本地态即时重排，dragend 落库
  const dragId = useRef<string | null>(null)

  const reload = useCallback(async () => {
    setLoading(true)
    try {
      const [{ sources: list }, { groups: grps }] = await Promise.all([
        api.listSkillSources(),
        api.listSkillGroups(),
      ])
      setSources(list)
      setGroups(grps)
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
      setGroups([])
      setProbesBySource({})
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void reload() }, [reload])

  useEffect(() => {
    api.listEntityRequirements().then(r => setReqs(r.requirements)).catch(() => {})
    api.listSkillLibrary().then(r => setLibSkills(r.skills)).catch(() => {})
    api.listSecrets().then(r => setSecrets(r.secrets)).catch(() => {})
  }, [])

  // ── cfgState：按 effectiveName 计算配置标志三态。绑定且所绑密钥「有值」才算 done ──
  const cfgStateOf = useCallback((effectiveName: string | undefined, fallbackName: string): 'need' | 'done' | 'none' => {
    const eff = effectiveName ?? fallbackName
    const r = reqs['skill:' + eff]
    if (r?.slots && r.slots.length > 0) {
      return r.slots.every(s => s.bind != null && secrets.find(x => x.id === s.bind)?.hasValue) ? 'done' : 'need'
    }
    const ls = libSkills.find(s => s.effectiveName === eff)
    if (ls?.needsConfig) return 'need'
    return 'none'
  }, [reqs, libSkills, secrets])

  // ── derived ──
  const probesOf = useCallback((sid: string): ProbedSkill[] => probesBySource[sid] ?? [], [probesBySource])
  const inLibCount = useCallback((sid: string) => probesOf(sid).filter(k => k.inLib).length, [probesOf])
  const totalInLib = useMemo(
    () => sources.reduce((n, s) => n + (s.type === 'market' ? 0 : inLibCount(s.id)), 0),
    [sources, inLibCount]
  )

  // 某分组的成员（= groupId 命中的源）
  const membersOf = useCallback((gid: string) => sources.filter(s => s.groupId === gid), [sources])

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

  // 默认注入开关：按 effectiveName 调 setAutoInject 后刷新 libSkills（autoInject 唯一真相在库侧）
  const handleToggleAutoInject = async (effectiveName: string, cur: boolean) => {
    try {
      await api.setAutoInject(effectiveName, !cur)
      const r = await api.listSkillLibrary()
      setLibSkills(r.skills)
    } catch { /* 失败保持原态 */ }
  }

  // 分组级批量加入/移出：对该分组所有成员的技能整体操作
  const handleGroupBulk = async (on: boolean, gid: string) => {
    const ops: Promise<unknown>[] = []
    membersOf(gid).forEach(s => probesOf(s.id).forEach(k => {
      if (k.inLib !== on) ops.push(api.toggleSkillLib({ sourceId: s.id, relPath: k.relPath, inLib: on }).catch(() => null))
    }))
    await Promise.all(ops)
    await reload()
  }

  const handleReprobe = async (s: SkillSourceDef) => {
    setReprobingId(s.id)
    try {
      const { skills } = await api.reprobeSkillSource(s.id)
      setProbesBySource(prev => ({ ...prev, [s.id]: skills }))
    } catch { /* keep */ } finally {
      setReprobingId(null)
    }
  }

  // 移除成员（源）：留在当前分组详情
  const handleRemoveMember = async (s: SkillSourceDef) => {
    try { await api.removeSkillSource(s.id) } catch { /* */ }
    await reload()
  }

  // 更新分组全部：对成员逐个重新探测
  const handleUpdateGroup = async (gid: string) => {
    const ms = membersOf(gid)
    for (const s of ms) {
      try {
        const { skills } = await api.reprobeSkillSource(s.id)
        setProbesBySource(prev => ({ ...prev, [s.id]: skills }))
      } catch { /* skip */ }
    }
    await reload()
  }

  // 分组改名（内联）
  const startRename = (g: SkillGroupDef) => { setRenameVal(g.name); setRenaming(true) }
  const commitRename = async (g: SkillGroupDef) => {
    if (!renaming) return
    setRenaming(false)
    const v = renameVal.trim()
    if (!v || v === g.name) return
    try { await api.patchSkillGroup(g.id, { name: v }); await reload() } catch { /* */ }
  }

  // 添加分组：新建空分组 → 选中 → 进入改名
  const handleAddGroup = async () => {
    try {
      const { group } = await api.addSkillGroup({ name: '新分组' })
      await reload()
      setSelected(group.id)
      setGroupFilter('all')
      startRename(group)
    } catch { /* */ }
  }

  // 删除分组（级联移除成员）
  const handleDeleteGroup = async (g: SkillGroupDef) => {
    try { await api.removeSkillGroup(g.id) } catch { /* */ }
    setSelected(LIB)
    await reload()
  }

  // 分组拖拽排序
  const handleReorderEnd = async () => {
    dragId.current = null
    try { await api.reorderSkillGroups(groups.map(g => g.id)) } catch { /* best-effort */ }
  }
  const handleDragOver = (overId: string) => {
    const from = dragId.current
    if (from == null || from === overId) return
    setGroups(prev => {
      const fi = prev.findIndex(x => x.id === from)
      const ti = prev.findIndex(x => x.id === overId)
      if (fi < 0 || ti < 0) return prev
      const next = prev.slice()
      const [moved] = next.splice(fi, 1)
      next.splice(ti, 0, moved)
      return next
    })
  }

  // 「添加成员」下拉落点 = 当前分组
  const onPickAddMember = (gid: string) => (kind: 'folder' | 'git' | 'market') => {
    if (kind === 'market') return // 技能市场即将上线，no-op
    setAddSource({ kind, existing: null, groupId: gid })
  }

  const selGroup = selected === LIB ? null : groups.find(g => g.id === selected) ?? null

  // 分组级聚合计数
  const groupCounts = useCallback((gid: string) => {
    const ms = membersOf(gid)
    let total = 0, inN = 0
    let priv = false
    ms.forEach(s => {
      if (s.private) priv = true
      probesOf(s.id).forEach(k => { total++; if (k.inLib) inN++ })
    })
    return { members: ms.length, total, inN, priv }
  }, [membersOf, probesOf])

  // ── render: left column = 分组列表 ──
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
        <div className="lab2">技能分组</div>
        <button className="skill-new" type="button" onClick={() => void handleAddGroup()}>
          <IconPlus />添加分组
        </button>
      </div>
      <div className="src-list">
        {groups.map(g => {
          const c = groupCounts(g.id)
          return (
            <div
              key={g.id}
              className={`src-row${g.id === selected ? ' on' : ''}`}
              data-id={g.id}
              draggable
              onClick={() => { setSelected(g.id); setGroupFilter('all') }}
              onDragStart={() => { dragId.current = g.id }}
              onDragEnd={handleReorderEnd}
              onDragOver={(e) => { e.preventDefault(); handleDragOver(g.id) }}
            >
              <span className="src-handle" title="拖动排序"><IconHandle /></span>
              <span className="src-ic src-ic--group"><IconGroup /></span>
              <div className="src-row-main">
                <div className="src-row-top">
                  <span className="src-name">{g.name}</span>
                  {c.priv && <span className="src-badge src-badge--priv"><IconLock />私有</span>}
                </div>
                <div className="src-row-sub">
                  {c.members} 来源 · {c.total} 技能 · 已加入 {c.inN}
                </div>
              </div>
            </div>
          )
        })}
        {!loading && groups.length === 0 && (
          <div className="sm-empty">还没有技能分组 —— 点「添加分组」新建一个</div>
        )}
      </div>
    </div>
  )

  // ── render: right detail (library view) ──
  const libView = () => {
    const inN = allItems.filter(it => it.skill.inLib).length
    const outN = allItems.length - inN
    const srcN = new Set(allItems.filter(it => it.skill.inLib).map(it => it.source.id)).size
    // autoInject 唯一真相在 libSkills（ProbedSkill 不含该字段）→ 按 effectiveName/name 关联取
    const autoInjectOf = (k: ProbedSkill): boolean =>
      libSkills.find(s => s.effectiveName === (k.effectiveName ?? k.name))?.autoInject ?? false
    const autoN = allItems.filter(it => autoInjectOf(it.skill)).length
    let list = allItems
    if (libFilter === 'in') list = list.filter(it => it.skill.inLib)
    else if (libFilter === 'out') list = list.filter(it => !it.skill.inLib)
    else if (libFilter === 'auto') list = list.filter(it => autoInjectOf(it.skill))
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
          <button className={`lib-filter-btn${libFilter === 'auto' ? ' on' : ''}`} type="button" onClick={() => setLibFilter('auto')}>自动注入 {autoN}</button>
        </div>
        <SkillSearch value={skillQ} onChange={setSkillQ} />
        <div className="src-skills" style={{ marginTop: 6 }}>
          {list.length === 0 ? (
            <div className="sm-empty">
              {skillQ ? '没有匹配的技能' : libFilter === 'out' ? '探测到的技能都已入库' : libFilter === 'in' ? '技能库为空 —— 切到「未入库」挑选技能加入' : libFilter === 'auto' ? '还没有默认注入的技能 —— 在技能行右侧打开「默认注入」' : '没有技能'}
            </div>
          ) : list.map(it => {
            const eff = it.skill.effectiveName ?? it.skill.name
            const ai = autoInjectOf(it.skill)
            return (
              <SkillRow
                key={`${it.source.id}:${it.skill.relPath}`}
                skill={it.skill}
                variant="lib"
                sourceName={it.source.name}
                isDup={dupNames.has(it.skill.name)}
                cfgState={cfgStateOf(it.skill.effectiveName, it.skill.name)}
                onClick={() => openSkill(it.source, it.skill)}
                autoInject={ai}
                onToggleAutoInject={() => void handleToggleAutoInject(eff, ai)}
              />
            )
          })}
        </div>
      </>
    )
  }

  return (
    <>
      <p className="set-kicker">设置</p>
      <h2 className="set-h">技能</h2>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <p className="set-sub" style={{ margin: 0, flex: 1 }}>注册技能来源，自动探测其中的 SKILL.md，挑选需要的技能加入技能库。某次任务真正生效的，由发送时的「注入技能」决定。</p>
        <button className="secrets-link" type="button" onClick={() => openSettings('secrets')}>🔑 管理密钥</button>
      </div>

      <div className="src-layout">
        {leftCol}
        <div className="src-detail">
          {selected === LIB
            ? libView()
            : selGroup
              ? <GroupDetail
                  g={selGroup}
                  members={membersOf(selGroup.id)}
                  isSystem={SYSTEM_GROUPS.has(selGroup.id)}
                  probesOf={probesOf}
                  inLibCount={inLibCount}
                  skillQ={skillQ}
                  setSkillQ={setSkillQ}
                  groupFilter={groupFilter}
                  setGroupFilter={setGroupFilter}
                  dupNames={dupNames}
                  reprobingId={reprobingId}
                  renaming={renaming}
                  renameVal={renameVal}
                  setRenameVal={setRenameVal}
                  onStartRename={() => startRename(selGroup)}
                  onCommitRename={() => commitRename(selGroup)}
                  onCancelRename={() => setRenaming(false)}
                  onMemberMode={handleMode}
                  onMemberReprobe={handleReprobe}
                  onMemberEdit={(s) => setAddSource({ kind: s.type === 'git' ? 'git' : 'folder', existing: s, groupId: selGroup.id })}
                  onMemberRemove={handleRemoveMember}
                  onAddMember={onPickAddMember(selGroup.id)}
                  onBulk={(on) => handleGroupBulk(on, selGroup.id)}
                  onUpdateGroup={() => handleUpdateGroup(selGroup.id)}
                  onDeleteGroup={() => handleDeleteGroup(selGroup)}
                  onOpenSkill={openSkill}
                  cfgStateOf={cfgStateOf}
                />
              : <div className="src-detail-empty">从左侧选择一个分组查看其技能</div>}
        </div>
      </div>

      {addSource && (
        <AddSourceModal
          kind={addSource.kind}
          existing={addSource.existing}
          groupId={addSource.groupId}
          onSaved={(saved) => { setAddSource(null); setSelected(saved.groupId ?? selected); void reload() }}
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

// ── MemberStrip：紧凑成员条（每个成员一行，自带更新策略/重新探测/编辑/移除）──────
interface MemberStripProps {
  members: SkillSourceDef[]
  isSystem: boolean
  probesOf: (sid: string) => ProbedSkill[]
  inLibCount: (sid: string) => number
  reprobingId: string | null
  onMode: (mode: UpdateMode, s: SkillSourceDef) => void
  onReprobe: (s: SkillSourceDef) => void
  onEdit: (s: SkillSourceDef) => void
  onRemove: (s: SkillSourceDef) => void
}
function MemberStrip(p: MemberStripProps) {
  if (p.members.length === 0) {
    return (
      <div className="mem-strip mem-strip--empty">
        {p.isSystem
          ? '系统分组的成员由 Agent Shell 自动维护。'
          : '这个分组还没有来源 —— 点「添加成员」加入 git 仓库或本地文件夹。'}
      </div>
    )
  }
  return (
    <div className="mem-strip">
      {p.members.map(s => {
        const mode = s.updateMode ?? 'manual'
        return (
          <div className="mem-row" key={s.id} data-mem={s.id}>
            <span className={`src-ic ${srcIcCls(s)} mem-ic`}><SrcIconSvg s={s} /></span>
            <div className="mem-info">
              <div className="mem-name">
                {s.name}
                {s.private && <span className="src-badge src-badge--priv"><IconLock />私有</span>}
              </div>
              <div className="mem-meta">
                <span className="mem-type">{typeLabel(s)}</span>
                <code>{s.loc}</code>
                {s.branch && <span>分支 <code>{s.branch}</code></span>}
                <span className="mem-stat">
                  {p.probesOf(s.id).length} 技能 · 入库 {p.inLibCount(s.id)}
                </span>
              </div>
            </div>
            <div className="mem-actions">
              <select
                className="mem-mode"
                title="更新策略"
                value={mode}
                onChange={e => p.onMode(e.target.value as UpdateMode, s)}
              >
                <option value="manual">手动</option>
                <option value="auto">自动更新</option>
                <option value="autolib">自动+入库</option>
              </select>
              <button
                className={`mem-act${p.reprobingId === s.id ? ' is-busy' : ''}`}
                type="button"
                title="重新探测"
                onClick={() => p.onReprobe(s)}
              ><IconRefresh /></button>
              <button className="mem-act" type="button" title="编辑来源" onClick={() => p.onEdit(s)}><IconPencil /></button>
              <button className="mem-act mem-act--danger" type="button" title="移除此来源" onClick={() => p.onRemove(s)}><IconTrash /></button>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ── GroupDetail（右栏分组详情：头部 + 成员条 + 聚合技能）───────────────────────
interface GroupDetailProps {
  g: SkillGroupDef
  members: SkillSourceDef[]
  isSystem: boolean
  probesOf: (sid: string) => ProbedSkill[]
  inLibCount: (sid: string) => number
  skillQ: string
  setSkillQ: (v: string) => void
  groupFilter: 'in' | 'out' | 'all'
  setGroupFilter: (v: 'in' | 'out' | 'all') => void
  dupNames: Set<string>
  reprobingId: string | null
  renaming: boolean
  renameVal: string
  setRenameVal: (v: string) => void
  onStartRename: () => void
  onCommitRename: () => void
  onCancelRename: () => void
  onMemberMode: (mode: UpdateMode, s: SkillSourceDef) => void
  onMemberReprobe: (s: SkillSourceDef) => void
  onMemberEdit: (s: SkillSourceDef) => void
  onMemberRemove: (s: SkillSourceDef) => void
  onAddMember: (kind: 'folder' | 'git' | 'market') => void
  onBulk: (on: boolean) => void
  onUpdateGroup: () => void
  onDeleteGroup: () => void
  onOpenSkill: (s: SkillSourceDef, k: ProbedSkill) => void
  cfgStateOf: (effectiveName: string | undefined, fallbackName: string) => 'need' | 'done' | 'none'
}

function GroupDetail(p: GroupDetailProps) {
  const { g, members, isSystem, cfgStateOf } = p
  // 聚合该分组下所有成员的技能；每条标出来自哪个成员源
  const items = useMemo(() => {
    const out: { source: SkillSourceDef; skill: ProbedSkill }[] = []
    members.forEach(s => { if (s.type !== 'market') p.probesOf(s.id).forEach(k => out.push({ source: s, skill: k })) })
    return out
  }, [members, p])
  const total = items.length
  const inN = items.filter(it => it.skill.inLib).length

  let list = items
  if (p.groupFilter === 'in') list = list.filter(it => it.skill.inLib)
  else if (p.groupFilter === 'out') list = list.filter(it => !it.skill.inLib)
  list = list.filter(it => matchSkill(it.skill, p.skillQ))

  return (
    <>
      <div className="src-d-head">
        <span className="src-ic src-ic--group" style={{ width: 40, height: 40, borderRadius: 10 }}><IconGroup /></span>
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
              <span className="src-d-name-text">{g.name}</span>
            )}
            {!p.renaming && !isSystem && (
              <button className="src-d-rename" type="button" title="重命名分组" onClick={p.onStartRename}><IconPencil /></button>
            )}
          </div>
          <div className="src-d-loc">{members.length} 个来源 · 探测到 {total} 个技能</div>
        </div>
        <div className="src-d-actions">
          {members.length > 0 && (
            <button className="src-d-btn src-d-btn--accent" type="button" onClick={p.onUpdateGroup} title="重新探测分组内所有来源">
              <IconRefresh />更新全部
            </button>
          )}
          {!isSystem && <AddMemberMenu onPick={p.onAddMember} />}
          {!isSystem && (
            <button className="src-d-btn src-d-btn--danger" type="button" onClick={p.onDeleteGroup}>删除分组</button>
          )}
        </div>
      </div>

      <MemberStrip
        members={members}
        isSystem={isSystem}
        probesOf={p.probesOf}
        inLibCount={p.inLibCount}
        reprobingId={p.reprobingId}
        onMode={p.onMemberMode}
        onReprobe={p.onMemberReprobe}
        onEdit={p.onMemberEdit}
        onRemove={p.onMemberRemove}
      />

      <div className="src-d-summary">
        <span className="src-d-count">探测到 <b>{total}</b> 个技能 · 已加入库 <b>{inN}</b></span>
        <span className="src-d-bulk">
          <button type="button" onClick={() => p.onBulk(true)}>全选加入</button>
          <button type="button" onClick={() => p.onBulk(false)}>全部移出</button>
        </span>
      </div>

      <div className="lib-filter">
        <button className={`lib-filter-btn${p.groupFilter === 'in' ? ' on' : ''}`} type="button" onClick={() => p.setGroupFilter('in')}>已入库 {inN}</button>
        <button className={`lib-filter-btn${p.groupFilter === 'out' ? ' on' : ''}`} type="button" onClick={() => p.setGroupFilter('out')}>未入库 {total - inN}</button>
        <button className={`lib-filter-btn${p.groupFilter === 'all' ? ' on' : ''}`} type="button" onClick={() => p.setGroupFilter('all')}>全部 {total}</button>
      </div>

      <SkillSearch value={p.skillQ} onChange={p.setSkillQ} />
      <div className="src-skills">
        {list.length === 0 ? (
          <div className="sm-empty">
            {p.skillQ ? '没有匹配的技能' : p.groupFilter === 'out' ? '该分组的技能都已入库' : p.groupFilter === 'in' ? '该分组还没有技能入库 —— 切到「未入库」挑选' : '该分组里没有探测到 SKILL.md'}
          </div>
        ) : list.map(it => (
          <SkillRow
            key={`${it.source.id}:${it.skill.relPath}`}
            skill={it.skill}
            variant="lib"
            sourceName={it.source.name}
            isDup={p.dupNames.has(it.skill.name)}
            cfgState={cfgStateOf(it.skill.effectiveName, it.skill.name)}
            onClick={() => p.onOpenSkill(it.source, it.skill)}
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
