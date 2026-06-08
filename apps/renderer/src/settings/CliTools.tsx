import { useCallback, useEffect, useState } from 'react'
import { api } from '../api/client'
import type { CliToolDef, CliToolRuntimeInfo, CustomCliTool, CliToolPlatform } from '../api/types'

const IconPlus = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round"><path d="M12 5v14M5 12h14" /></svg>
)
const IconChevron = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round"><polyline points="6 9 12 15 18 9" /></svg>
)
const IconClose = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round"><path d="M6 6l12 12M18 6L6 18" /></svg>
)

function Section({ title, count, children }: { title: string; count: number; children: React.ReactNode }) {
  return (
    <div className="clit-sec">
      <div className="clit-sec-head"><span className="clit-sec-title">{title}</span><span className="clit-sec-count">{count}</span></div>
      {children}
    </div>
  )
}

// 已安装的 catalog 工具卡片：只显示版本，无「安装」按钮（已在系统里，无「移除」）
interface InstalledCardProps {
  tool: CliToolDef
  info: CliToolRuntimeInfo
  open: boolean
  onToggleOpen: () => void
}
function InstalledCard({ tool, info, open, onToggleOpen }: InstalledCardProps) {
  return (
    <div className={`clit-card${open ? ' is-open' : ''}`} data-id={tool.id}>
      <div className="clit-card-top">
        <div className="clit-name">{tool.name}</div>
      </div>
      <div className="clit-desc">{tool.summary}</div>
      <div className="clit-foot">
        <div className="clit-fr">
          <span className="clit-stat ok">● 已安装{info.version ? ` v${info.version}` : ''}</span>
        </div>
        <div className="clit-foot-r">
          <button className="clit-chev" type="button" title="详情" onClick={onToggleOpen}><IconChevron /></button>
        </div>
      </div>
      {open && (
        <div className="clit-detail">
          <div className="clit-drow">
            <div className="clit-dlab">简介</div>
            <div>{tool.detailIntro || tool.summary}</div>
          </div>
          {tool.useCases.length > 0 && (
            <div className="clit-drow">
              <div className="clit-dlab">用途</div>
              <ul style={{ margin: 0, paddingLeft: '1.2em' }}>{tool.useCases.map((u, i) => <li key={i}>{u}</li>)}</ul>
            </div>
          )}
          {tool.home && (
            <div className="clit-drow"><a className="clit-link" href={tool.home} target="_blank" rel="noreferrer">官网 ↗</a></div>
          )}
        </div>
      )}
    </div>
  )
}

// 自定义工具卡片：显示 binPath/version/description，可移除
interface CustomCardProps {
  tool: CustomCliTool
  onRemove: () => void
}
function CustomCard({ tool, onRemove }: CustomCardProps) {
  return (
    <div className="clit-card" data-id={tool.id}>
      <div className="clit-card-top">
        <div className="clit-name">
          {tool.name || tool.binName}
          <span className="clit-tags"><span className="clit-tag">自定义</span></span>
        </div>
      </div>
      {tool.description && <div className="clit-desc">{tool.description}</div>}
      <div className="clit-foot">
        <div className="clit-fr">
          <span className="clit-stat ok">● {tool.version ? `v${tool.version}` : '已登记'}</span>
          <span style={{ marginLeft: 6, fontSize: '0.78em', color: 'var(--fg-3)' }}>{tool.binPath}</span>
        </div>
        <div className="clit-foot-r">
          <button className="clit-act" type="button" style={{ color: 'var(--fg-3)' }} onClick={onRemove}>移除</button>
        </div>
      </div>
    </div>
  )
}

// 可安装工具卡片：点「安装」→ 触发 onInstallSeed，预填首页 composer 引导 agent 安装
interface CanInstallCardProps {
  tool: CliToolDef
  platform: CliToolPlatform
  open: boolean
  onToggleOpen: () => void
  onInstall: () => void
}
function CanInstallCard({ tool, platform, open, onToggleOpen, onInstall }: CanInstallCardProps) {
  // 取当前平台首选安装方式（用于展示参考命令）
  const platformMethod = tool.installMethods.find((m) => m.platforms.includes(platform))
  return (
    <div className={`clit-card${open ? ' is-open' : ''}`} data-id={tool.id}>
      <div className="clit-card-top">
        <div className="clit-name">{tool.name}</div>
      </div>
      <div className="clit-desc">{tool.summary}</div>
      <div className="clit-foot">
        <div className="clit-foot-r">
          <button className="clit-chev" type="button" title="详情" onClick={onToggleOpen}><IconChevron /></button>
          <button className="clit-act is-add" type="button" onClick={onInstall}><IconPlus />安装</button>
        </div>
      </div>
      {open && (
        <div className="clit-detail">
          <div className="clit-drow">
            <div className="clit-dlab">简介</div>
            <div>{tool.detailIntro || tool.summary}</div>
          </div>
          {platformMethod && (
            <div className="clit-drow">
              <div className="clit-dlab">安装命令（参考）</div>
              <div className="clit-cmd"><code>{platformMethod.command}</code></div>
            </div>
          )}
          {tool.useCases.length > 0 && (
            <div className="clit-drow">
              <div className="clit-dlab">用途</div>
              <ul style={{ margin: 0, paddingLeft: '1.2em' }}>{tool.useCases.map((u, i) => <li key={i}>{u}</li>)}</ul>
            </div>
          )}
          {tool.home && (
            <div className="clit-drow"><a className="clit-link" href={tool.home} target="_blank" rel="noreferrer">官网 ↗</a></div>
          )}
        </div>
      )}
    </div>
  )
}

// 自定义登记弹窗：按绝对路径登记（binPath 必填，name/description 可选）
interface AddCustomModalProps { onClose: () => void; onSave: (binPath: string, name?: string, description?: string) => void }
function AddCustomModal({ onClose, onSave }: AddCustomModalProps) {
  const [binPath, setBinPath] = useState('')
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', esc)
    return () => document.removeEventListener('keydown', esc)
  }, [onClose])
  const save = () => {
    if (!binPath.trim()) return
    onSave(binPath.trim(), name.trim() || undefined, description.trim() || undefined)
  }
  return (
    <div className="modal-backdrop open" onClick={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <div className="np-modal" role="dialog" aria-label="登记 CLI 工具" style={{ maxHeight: '88vh', overflow: 'auto' }}>
        <button className="modal-close" type="button" title="关闭 (Esc)" onClick={onClose}><IconClose /></button>
        <h2 className="np-h">登记 CLI 工具</h2>
        <p className="np-sub">按绝对路径登记一个本机命令行工具，登记后 daemon 检测安装状态，用途说明会注入 agent 的工具上下文（让它知道这工具可用）。</p>
        <div className="field"><div className="field-label">可执行文件绝对路径<span className="req">*</span></div><input className="field-input" value={binPath} onChange={(e) => setBinPath(e.target.value)} placeholder="如 /usr/local/bin/jq 或 /opt/homebrew/bin/ffmpeg" autoFocus /></div>
        <div className="field"><div className="field-label">名称（可选）</div><input className="field-input" value={name} onChange={(e) => setName(e.target.value)} placeholder="如 jq（留空则取可执行文件名）" /></div>
        <div className="field"><div className="field-label">用途说明（可选）</div><textarea className="field-textarea" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="一句话告诉 agent 这个工具能干什么…" /></div>
        <div className="np-actions"><button className="btn btn-ghost" type="button" onClick={onClose}>取消</button><button className="btn btn-primary" type="button" onClick={save} disabled={!binPath.trim()}>添加</button></div>
      </div>
    </div>
  )
}

interface CliToolsProps {
  // onInstallSeed：点「安装」后跳首页并预填 composer 引导 agent 安装
  onInstallSeed?: (text: string) => void
}

export function CliTools({ onInstallSeed }: CliToolsProps) {
  const [catalog, setCatalog] = useState<CliToolDef[]>([])
  const [detected, setDetected] = useState<CliToolRuntimeInfo[]>([])
  const [custom, setCustom] = useState<CustomCliTool[]>([])
  const [platform, setPlatform] = useState<CliToolPlatform>('darwin')
  const [open, setOpen] = useState<Set<string>>(new Set())
  const [adding, setAdding] = useState(false)
  const [loading, setLoading] = useState(true)   // 首次加载（catalog + 本机检测未返回）显示「检测中」，避免直接闪空态

  const load = useCallback(async () => {
    // catalog 和 installed 独立加载，失败各自兜底空，不互相阻塞
    const [catRes, instRes] = await Promise.allSettled([
      api.getCliCatalog(),
      api.getCliInstalled(),
    ])
    if (catRes.status === 'fulfilled') setCatalog(catRes.value.tools)
    if (instRes.status === 'fulfilled') {
      setDetected(instRes.value.detected)
      setCustom(instRes.value.custom)
      setPlatform(instRes.value.platform)
    }
    setLoading(false)   // catalog + 检测都尘埃落定后，才允许显示空态
  }, [])
  useEffect(() => { void load() }, [load])

  // 已检测到安装的 catalog 工具（id 匹配 detected 里 status==='installed' 的）
  const detectedMap = new Map(detected.map((d) => [d.id, d]))
  const installedCatalog = catalog.filter((t) => detectedMap.get(t.id)?.status === 'installed')
  const installedIds = new Set(installedCatalog.map((t) => t.id))

  // 可安装：未装 且 有当前平台安装方式的 catalog 工具
  const canInstall = catalog.filter((t) => {
    if (installedIds.has(t.id)) return false
    return t.installMethods.some((m) => m.platforms.includes(platform))
  })

  const toggleOpen = (id: string) => setOpen((prev) => {
    const n = new Set(prev)
    if (n.has(id)) n.delete(id); else n.add(id)
    return n
  })

  // 点「安装」：构造安装提示词 → 传给 AppNav → 跳首页 + 预填 composer
  const handleInstall = (tool: CliToolDef) => {
    if (!onInstallSeed) return
    const method = tool.installMethods.find((m) => m.platforms.includes(platform))
    const refCmd = method?.command ?? `# 请参考官方文档安装 ${tool.name}`
    const prompt = `帮我安装命令行工具「${tool.name}」(id: ${tool.id})（参考命令：${refCmd}）。用 as_cli_install 装好并顺手补用途说明。`
    onInstallSeed(prompt)
  }

  const handleAddCustom = async (binPath: string, name?: string, description?: string) => {
    setAdding(false)
    try { await api.addCustomCliTool(binPath, name, description) } catch { /* 静默，不崩页 */ }
    await load()
  }

  const handleRemoveCustom = async (id: string) => {
    try { await api.removeCustomCliTool(id) } catch { /* 静默，不崩页 */ }
    await load()
  }

  // 已安装区总数：catalog 已装 + custom
  const installedCount = installedCatalog.length + custom.length

  return (
    <>
      <p className="set-kicker">集成</p>
      <h2 className="set-h">命令行工具</h2>
      <p className="set-sub">检测本机已装的命令行工具，把用法注入给 agent；未装的可以让 agent 帮你安装。也可以按绝对路径登记自定义工具。</p>

      <div className="clit-top">
        <button className="skill-new" type="button" onClick={() => setAdding(true)}><IconPlus />登记自定义工具</button>
      </div>

      {/* 已安装区 */}
      <Section title="已安装" count={installedCount}>
        {loading
          ? <div className="clit-empty">正在检测本机已安装的命令行工具…</div>
          : installedCount === 0
          ? <div className="clit-empty">暂未检测到已安装的工具——daemon 在后台探测，稍后刷新可见。</div>
          : (
            <div className="clit-grid">
              {installedCatalog.map((tool) => {
                const info = detectedMap.get(tool.id)!
                return (
                  <InstalledCard
                    key={tool.id}
                    tool={tool}
                    info={info}
                    open={open.has(tool.id)}
                    onToggleOpen={() => toggleOpen(tool.id)}
                  />
                )
              })}
              {custom.map((ct) => (
                <CustomCard key={ct.id} tool={ct} onRemove={() => void handleRemoveCustom(ct.id)} />
              ))}
            </div>
          )}
      </Section>

      {/* 可安装区（仅当前平台有方式的工具） */}
      <Section title="可安装" count={canInstall.length}>
        {loading
          ? <div className="clit-empty">正在检测可安装的命令行工具…</div>
          : canInstall.length === 0
          ? <div className="clit-empty">暂无适合当前平台的可安装工具。</div>
          : (
            <div className="clit-grid">
              {canInstall.map((tool) => (
                <CanInstallCard
                  key={tool.id}
                  tool={tool}
                  platform={platform}
                  open={open.has(tool.id)}
                  onToggleOpen={() => toggleOpen(tool.id)}
                  onInstall={() => handleInstall(tool)}
                />
              ))}
            </div>
          )}
      </Section>

      {adding && <AddCustomModal onClose={() => setAdding(false)} onSave={(binPath, name, desc) => void handleAddCustom(binPath, name, desc)} />}
    </>
  )
}
