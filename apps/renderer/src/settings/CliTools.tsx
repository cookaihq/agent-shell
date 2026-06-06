import { useCallback, useEffect, useMemo, useState } from 'react'
import { api } from '../api/client'
import type { CliToolDef } from '../api/types'
import RECOMMENDED_RAW from '../integrations/cliTools.zh.json'

// 内置策展推荐列表（friendliness 等为策展元数据，写死）。加入后由 daemon 持久化并生成 SKILL.md 注入。
const RECOMMENDED = RECOMMENDED_RAW as CliToolDef[]

const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4-4" /></svg>
)
const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
)
const IconChevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
)
const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
)

function Hearts({ n }: { n: number }) {
  return (
    <span className="clit-hearts" title={`Agent 友好度 ${n}/5`}>
      {Array.from({ length: 5 }, (_, i) => (
        <span key={i} className={i < n ? '' : 'off'}>{i < n ? '♥' : '♡'}</span>
      ))}
    </span>
  )
}

function CopyBtn({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="clit-copy"
      type="button"
      onClick={() => {
        if (navigator.clipboard) void navigator.clipboard.writeText(text).catch(() => { /* */ })
        setCopied(true); setTimeout(() => setCopied(false), 1200)
      }}
    >{copied ? '已复制' : '复制'}</button>
  )
}

interface CardProps {
  tool: CliToolDef
  added: boolean
  installedPath: string | null | undefined
  open: boolean
  onToggleOpen: () => void
  onAdd: () => void
  onRemove: () => void
}
function Card({ tool, added, installedPath, open, onToggleOpen, onAdd, onRemove }: CardProps) {
  const installed = !!installedPath
  return (
    <div className={`clit-card${open ? ' is-open' : ''}`} data-id={tool.id}>
      <div className="clit-card-top">
        <div className="clit-name">
          {tool.name}
          <span className="clit-tags">{tool.tags.map((t) => <span key={t} className="clit-tag">{t}</span>)}</span>
        </div>
      </div>
      <div className="clit-desc">{tool.desc}</div>
      <div className="clit-foot">
        <div className="clit-fr">Agent 友好度 <Hearts n={tool.friendliness} /></div>
        <div className="clit-foot-r">
          <button className="clit-chev" type="button" title="详情" onClick={onToggleOpen}><IconChevron /></button>
          {added
            ? <button className="clit-act is-added" type="button" onClick={onRemove}>✓ 已加入</button>
            : <button className="clit-act is-add" type="button" onClick={onAdd}><IconPlus />加入</button>}
        </div>
      </div>
      {open && (
        <div className="clit-detail">
          <div className="clit-drow">
            <div className="clit-dlab">安装状态</div>
            <span className={`clit-stat ${installed ? 'ok' : 'miss'}`}>
              ● {installed ? '已安装' : '未安装'}
              <span className="clit-stat-sub">（{installed ? `本机命中 ${tool.cmd}` : `本机未检测到 ${tool.cmd}`}）</span>
            </span>
          </div>
          {!installed && (
            <div className="clit-drow">
              <div className="clit-dlab">安装命令</div>
              <div className="clit-cmd"><code>{tool.install || `# 请按官方文档安装 ${tool.name}`}</code><CopyBtn text={tool.install || ''} /></div>
            </div>
          )}
          <div className="clit-drow">
            <div className="clit-dlab">注入给 agent 的用法</div>
            <div className="clit-usage">{tool.usage}</div>
          </div>
          {tool.home && (
            <div className="clit-drow"><a className="clit-link" href={tool.home} target="_blank" rel="noreferrer">官网 / 文档 ↗</a></div>
          )}
        </div>
      )}
    </div>
  )
}

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="clit-sec">
      <div className="clit-sec-head"><span className="clit-sec-title">{title}</span><span className="clit-sec-count">{count}</span></div>
      {children}
    </div>
  )
}

interface AddModalProps { onClose: () => void; onSave: (def: Omit<CliToolDef, 'id'>) => void }
function AddCliToolModal({ onClose, onSave }: AddModalProps) {
  const [name, setName] = useState('')
  const [cmd, setCmd] = useState('')
  const [install, setInstall] = useState('')
  const [tags, setTags] = useState('')
  const [usage, setUsage] = useState('')
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  const save = () => {
    if (!name.trim() || !cmd.trim()) return
    onSave({
      name: name.trim(), cmd: cmd.trim(),
      tags: tags.split(/[,，]/).map((s) => s.trim()).filter(Boolean),
      desc: '自定义命令行工具。',
      install: install.trim() || undefined,
      usage: usage.trim() || `调用 ${cmd.trim()} 完成相关任务。`,
      friendliness: 0, custom: true,
    })
  }
  return (
    <div className="modal-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="np-modal" role="dialog" aria-label="添加 CLI 工具" style={{ maxHeight: '88vh', overflow: 'auto' }}>
        <button className="modal-close" type="button" title="关闭 (Esc)" onClick={onClose}><IconClose /></button>
        <h2 className="np-h">添加 CLI 工具</h2>
        <p className="np-sub">登记一个本机命令行工具，加入后检测安装状态并把用法注入给 agent。</p>
        <div className="field"><div className="field-label">名称<span className="req">*</span></div><input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 Pandoc" autoFocus /></div>
        <div className="field"><div className="field-label">可执行命令<span className="req">*</span><span className="link">用于 which 检测</span></div><input className="field-input" value={cmd} onChange={(e) => setCmd(e.target.value)} placeholder="如 pandoc" /></div>
        <div className="field"><div className="field-label">安装命令</div><input className="field-input" value={install} onChange={(e) => setInstall(e.target.value)} placeholder="如 brew install pandoc" /></div>
        <div className="field"><div className="field-label">分类</div><input className="field-input" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="逗号分隔，如 开发,效率" /></div>
        <div className="field"><div className="field-label">用法说明（注入给 agent）</div><textarea className="field-textarea" value={usage} onChange={(e) => setUsage(e.target.value)} placeholder="一句话告诉 agent 这个工具能干什么、怎么调用…" /></div>
        <div className="np-actions"><button className="btn btn-ghost" type="button" onClick={onClose}>取消</button><button className="btn btn-primary" type="button" onClick={save}>添加</button></div>
      </div>
    </div>
  )
}

export function CliTools() {
  const [added, setAdded] = useState<CliToolDef[]>([])
  const [detected, setDetected] = useState<Record<string, string | null>>({})
  const [q, setQ] = useState('')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)

  const load = useCallback(async () => {
    let list: CliToolDef[] = []
    try { list = (await api.listCliTools()).tools } catch { list = [] }
    setAdded(list)
    const cmds = Array.from(new Set([...RECOMMENDED, ...list].map((t) => t.cmd)))
    try { setDetected((await api.detectClis(cmds)).detected) } catch { /* 探测失败：全显未安装，不崩页 */ }
  }, [])
  useEffect(() => { void load() }, [load])

  const addedIds = useMemo(() => new Set(added.map((t) => t.id)), [added])
  const recommended = useMemo(() => RECOMMENDED.filter((t) => !addedIds.has(t.id)), [addedIds])

  const match = useCallback((t: CliToolDef) => {
    const s = q.trim().toLowerCase()
    return !s || `${t.name} ${t.desc} ${t.tags.join(' ')}`.toLowerCase().includes(s)
  }, [q])
  const addedShown = added.filter(match)
  const recoShown = recommended.filter(match)

  const handleAdd = async (def: Omit<CliToolDef, 'id'> & { id?: string }) => {
    try { await api.addCliTool(def) } catch { /* */ }
    await load()
  }
  const handleRemove = async (id: string) => {
    try { await api.removeCliTool(id) } catch { /* */ }
    await load()
  }
  const toggleOpen = (id: string) => setOpen((prev) => {
    const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n
  })

  const renderCard = (tool: CliToolDef, isAdded: boolean) => (
    <Card
      key={tool.id}
      tool={tool}
      added={isAdded}
      installedPath={detected[tool.cmd]}
      open={open.has(tool.id)}
      onToggleOpen={() => toggleOpen(tool.id)}
      onAdd={() => void handleAdd(tool)}
      onRemove={() => void handleRemove(tool.id)}
    />
  )

  return (
    <>
      <p className="set-kicker">集成</p>
      <h2 className="set-h">命令行工具</h2>
      <p className="set-sub">把本机命令行工具接入 agent —— 加入后检测本机是否已安装、给出安装引导，并生成一个 SKILL.md 把用法注入给 agent（在「注入技能」里可选中），让它在任务里直接调用。</p>

      <div className="clit-top">
        <label className="clit-search">
          <IconSearch />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜索命令行工具…" autoComplete="off" />
        </label>
        <button className="skill-new" type="button" onClick={() => setAdding(true)}><IconPlus />添加 CLI 工具</button>
      </div>

      <Section title="已添加" count={addedShown.length}>
        {addedShown.length === 0
          ? <div className="clit-empty">{q ? '没有匹配的已添加工具' : '还没有加入任何工具 —— 从下方推荐里挑，或「添加 CLI 工具」自定义。'}</div>
          : <div className="clit-grid">{addedShown.map((t) => renderCard(t, true))}</div>}
      </Section>

      {!(q && recoShown.length === 0) && (
        <Section title="推荐" count={recoShown.length}>
          {recoShown.length === 0
            ? <div className="clit-empty">没有匹配的推荐工具</div>
            : <div className="clit-grid">{recoShown.map((t) => renderCard(t, false))}</div>}
        </Section>
      )}

      {adding && <AddCliToolModal onClose={() => setAdding(false)} onSave={(def) => { setAdding(false); void handleAdd(def) }} />}
    </>
  )
}
