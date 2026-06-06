import { useEffect, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { GitProvider, SkillSourceDef } from '../api/types'
import { IconClose } from '../ui/icons'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

interface Props {
  kind: 'folder' | 'git'
  existing?: SkillSourceDef | null  // 提供 = 编辑模式
  onSaved: (source: SkillSourceDef) => void
  onClose: () => void
}

const PROVIDER_LABEL: Record<GitProvider, string> = {
  github: 'GitHub',
  gitee: '码云',
  cnb: 'CNB',
  gitlab: 'GitLab',
  other: 'Git',
}
const PROVIDER_HOST: Record<GitProvider, string> = {
  github: 'github.com',
  gitee: 'gitee.com',
  cnb: 'cnb.cool',
  gitlab: 'gitlab.com',
  other: '',
}

// SVG icons — 1:1 from prototype integrations.html ICON object
const IconFolder = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
)

const IconGit = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
    <path d="M12 .5C5.7.5.5 5.7.5 12c0 5.1 3.3 9.4 7.9 10.9.6.1.8-.2.8-.5v-1.7c-3.2.7-3.9-1.5-3.9-1.5-.5-1.3-1.3-1.7-1.3-1.7-1.1-.7.1-.7.1-.7 1.2.1 1.8 1.2 1.8 1.2 1 1.8 2.7 1.3 3.4 1 .1-.8.4-1.3.7-1.6-2.6-.3-5.3-1.3-5.3-5.7 0-1.3.5-2.3 1.2-3.1-.1-.3-.5-1.5.1-3.1 0 0 1-.3 3.3 1.2a11.5 11.5 0 0 1 6 0C17.3 4.7 18.3 5 18.3 5c.6 1.6.2 2.8.1 3.1.8.8 1.2 1.8 1.2 3.1 0 4.4-2.7 5.4-5.3 5.7.4.4.8 1.1.8 2.2v3.3c0 .3.2.6.8.5 4.6-1.5 7.9-5.8 7.9-10.9C23.5 5.7 18.3.5 12 .5z" />
  </svg>
)

const IconGitAlt = () => (
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M6 3v12" />
    <circle cx="18" cy="6" r="3" />
    <circle cx="6" cy="18" r="3" />
    <path d="M18 9a9 9 0 0 1-9 9" />
  </svg>
)

function getHeadIcCls(kind: 'folder' | 'git', provider: GitProvider): string {
  if (kind === 'folder') return ''
  return provider === 'github' ? 'src-ic--git' : `src-ic--${provider}`
}

function getHeadIcSvg(kind: 'folder' | 'git', provider: GitProvider): JSX.Element {
  if (kind === 'folder') return <IconFolder />
  return provider === 'github' ? <IconGit /> : <IconGitAlt />
}

/** Auth fields — userFirst: gitee/cnb/other shows username first, then token.
 *  github/gitlab shows PAT first, then optional username. */
function AuthFields({
  provider,
  user,
  token,
  editMode,
  onUserChange,
  onTokenChange,
}: {
  provider: GitProvider
  user: string
  token: string
  editMode: boolean
  onUserChange: (v: string) => void
  onTokenChange: (v: string) => void
}) {
  const userFirst = provider === 'gitee' || provider === 'cnb' || provider === 'other'
  const hint = userFirst
    ? `${PROVIDER_LABEL[provider]} 私有库用「用户名 + Token」克隆。凭据仅保存在本机系统钥匙串。`
    : '凭据仅保存在本机系统钥匙串，只用于克隆/更新该仓库。'

  if (userFirst) {
    return (
      <>
        <div className="field">
          <div className="field-label">
            Git 用户名 <span className="req">*</span>
          </div>
          <input
            className="field-input"
            placeholder={provider === 'cnb' ? 'cnb' : '用户名'}
            value={user}
            onChange={e => onUserChange(e.target.value)}
          />
        </div>
        <div className="field" style={{ marginTop: 8 }}>
          <div className="field-label">
            Token <span className="req">*</span>
          </div>
          <input
            className="field-input"
            type="password"
            placeholder="eLTz3chgRxxxxxxx"
            value={token}
            onChange={e => onTokenChange(e.target.value)}
          />
          {editMode && (
            <div className="field-hint" style={{ marginTop: 4 }}>留空 = 保持原 Token 不变</div>
          )}
        </div>
        <div className="field-hint" style={{ marginTop: 8 }}>{hint}</div>
      </>
    )
  }

  // github / gitlab
  return (
    <>
      <div className="field">
        <div className="field-label">
          Personal Access Token <span className="req">*</span>
        </div>
        <input
          className="field-input"
          type="password"
          placeholder="ghp_…"
          value={token}
          onChange={e => onTokenChange(e.target.value)}
        />
        {editMode && (
          <div className="field-hint" style={{ marginTop: 4 }}>留空 = 保持原 Token 不变</div>
        )}
      </div>
      <div className="field" style={{ marginTop: 8 }}>
        <div className="field-label">
          用户名 <span className="field-opt">可选</span>
        </div>
        <input
          className="field-input"
          placeholder={`${PROVIDER_LABEL[provider]} 用户名`}
          value={user}
          onChange={e => onUserChange(e.target.value)}
        />
      </div>
      <div className="field-hint" style={{ marginTop: 8 }}>{hint}</div>
    </>
  )
}

export function AddSourceModal({ kind, existing, onSaved, onClose }: Props) {
  const isEdit = !!existing

  // Folder state
  const [path, setPath] = useState(existing?.type === 'folder' ? (existing.loc ?? '') : '')
  const [name, setName] = useState(existing?.type === 'folder' ? (existing.name ?? '') : '')

  // Git state
  const [provider, setProvider] = useState<GitProvider>(
    (existing?.provider) ?? 'github'
  )
  const [url, setUrl] = useState(existing?.type === 'git' ? (existing.loc ?? '') : '')
  const [branch, setBranch] = useState(existing?.type === 'git' ? (existing.branch ?? '') : '')
  const [priv, setPriv] = useState(existing?.type === 'git' ? (existing.private ?? false) : false)
  // token never pre-filled in edit mode (daemon redacts it)
  const [user, setUser] = useState(existing?.user ?? (provider === 'cnb' ? 'cnb' : ''))
  const [token, setToken] = useState('')

  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [loading, setLoading] = useState(false)

  // When provider changes, reset user default for CNB
  const handleProviderChange = (p: GitProvider) => {
    setProvider(p)
    // Reset user to CNB default only when adding new (not editing), and user hasn't typed
    if (!isEdit) {
      setUser(p === 'cnb' ? 'cnb' : '')
    }
    setMsg(null)
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  const save = async () => {
    setMsg(null)
    try {
      setLoading(true)
      let res: { source: SkillSourceDef }

      if (kind === 'folder') {
        const trimPath = path.trim()
        if (!trimPath) {
          setMsg({ text: '✗ 请输入文件夹路径', ok: false })
          return
        }
        if (isEdit && existing) {
          res = await api.patchSkillSource(existing.id, {
            name: name.trim() || existing.name,
            loc: trimPath || existing.loc,
          })
        } else {
          const derivedName = name.trim() || trimPath.split('/').filter(Boolean).pop() || 'skills'
          res = await api.addSkillSource({
            type: 'folder',
            name: derivedName,
            loc: trimPath,
            updateMode: 'manual',
          } as Omit<SkillSourceDef, 'id' | 'sortIndex'>)
        }
      } else {
        // git
        const rawUrl = url.trim()
        if (!rawUrl) {
          setMsg({ text: '✗ 请输入仓库地址', ok: false })
          return
        }
        const normalizedUrl = rawUrl.replace(/^https?:\/\//, '')
        if (isEdit && existing) {
          const gitPatch: Record<string, unknown> = {
            provider,
            loc: normalizedUrl || existing.loc,
            branch: branch.trim() || existing.branch,
            private: priv,
            user: priv ? (user.trim() || undefined) : '',
          }
          if (priv) {
            // private + typed token → send it; private + blank token → omit key (keep existing)
            const trimmed = token.trim()
            if (trimmed) gitPatch.token = trimmed
          } else {
            // turning public → explicitly clear the stored credential
            gitPatch.token = ''
          }
          res = await api.patchSkillSource(existing.id, gitPatch)
        } else {
          const derivedName = normalizedUrl.split('/').slice(-2).join('/')
          res = await api.addSkillSource({
            type: 'git',
            provider,
            name: derivedName,
            loc: normalizedUrl,
            branch: branch.trim() || 'main',
            private: priv,
            user: priv ? user.trim() : undefined,
            token: priv ? token.trim() || undefined : undefined,
            updateMode: 'manual',
          } as Omit<SkillSourceDef, 'id' | 'sortIndex'>)
        }
      }

      onSaved(res.source)
      onClose()
    } catch (err) {
      setMsg({ text: err instanceof ApiError ? `✗ ${err.message}` : '✗ 操作失败', ok: false })
    } finally {
      setLoading(false)
    }
  }

  const headIcCls = getHeadIcCls(kind, provider)
  const title = `${isEdit ? '编辑' : '添加'}${kind === 'git' ? ' Git 仓库' : ' 本地文件夹'}`

  return (
    <div className="modal-backdrop open" onClick={handleBackdrop}>
      <div className="src-modal" role="dialog" aria-label={title}>
        {/* Head */}
        <div className="src-modal__head">
          <span className={`src-ic ${headIcCls}`}>
            {getHeadIcSvg(kind, provider)}
          </span>
          <span className="src-modal__title">{title}</span>
          <IconButton variant="modal-close" title="关闭 (Esc)" onClick={onClose}>
            <IconClose size={16} />
          </IconButton>
        </div>

        {/* Body */}
        <div className="src-modal__body">
          {kind === 'folder' ? (
            <>
              <div className="field">
                <div className="field-label">
                  文件夹路径 <span className="req">*</span>
                </div>
                <div className="field-row">
                  <input
                    className="field-input"
                    placeholder="~/code/my-skills"
                    value={path}
                    onChange={e => setPath(e.target.value)}
                  />
                  <button
                    className="field-btn"
                    type="button"
                    onClick={async () => {
                      const bridge = window.agentShell
                      if (!bridge) return
                      const dir = await bridge.pickFolder()
                      if (dir) { setPath(dir); setMsg(null) }
                    }}
                  >选择…</button>
                </div>
                <div className="field-hint">添加后会探测该文件夹内的 SKILL.md。</div>
              </div>
              <div className="field" style={{ marginTop: 8 }}>
                <div className="field-label">
                  名称 <span className="field-opt">可选</span>
                </div>
                <input
                  className="field-input"
                  placeholder="留空则用文件夹名"
                  value={name}
                  onChange={e => setName(e.target.value)}
                />
              </div>
            </>
          ) : (
            <>
              {/* 托管平台 */}
              <div className="field">
                <div className="field-label">托管平台</div>
                <select
                  className="field-select"
                  value={provider}
                  onChange={e => handleProviderChange(e.target.value as GitProvider)}
                >
                  <option value="github">GitHub</option>
                  <option value="gitee">码云 Gitee</option>
                  <option value="cnb">CNB</option>
                  <option value="gitlab">GitLab</option>
                  <option value="other">其它 / 自建</option>
                </select>
              </div>

              {/* 仓库地址 */}
              <div className="field" style={{ marginTop: 8 }}>
                <div className="field-label">
                  仓库地址 <span className="req">*</span>
                </div>
                <input
                  className="field-input"
                  placeholder={`${PROVIDER_HOST[provider] || 'host'}/owner/repo`}
                  value={url}
                  onChange={e => setUrl(e.target.value)}
                />
              </div>

              {/* 分支 */}
              <div className="field" style={{ marginTop: 8 }}>
                <div className="field-label">
                  分支 <span className="field-opt">可选</span>
                </div>
                <input
                  className="field-input"
                  placeholder="main"
                  value={branch}
                  onChange={e => setBranch(e.target.value)}
                />
              </div>

              {/* 私有库 toggle */}
              <div className="src-toggle-row">
                <div>
                  <div className="lab">私有库</div>
                  <div className="desc">私有仓库需要凭据才能克隆</div>
                </div>
                <button
                  className={`toggle${priv ? ' on' : ''}`}
                  type="button"
                  onClick={() => setPriv(v => !v)}
                />
              </div>

              {/* Auth fields (shown when private=true) */}
              <div className={`src-auth${priv ? ' open' : ''}`}>
                <AuthFields
                  provider={provider}
                  user={user}
                  token={token}
                  editMode={isEdit}
                  onUserChange={setUser}
                  onTokenChange={setToken}
                />
              </div>
            </>
          )}

          {msg !== null && (
            <div className={`ska-msg ${msg.ok ? 'ok' : 'err'}`} style={{ marginTop: 8 }}>
              {msg.text}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="src-modal__foot">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={save} disabled={loading}>
            {loading ? (isEdit ? '保存中…' : '探测中…') : (isEdit ? '保存' : '探测并添加')}
          </Button>
        </div>
      </div>
    </div>
  )
}
