import { useEffect, useRef, useState } from 'react'
import { api, ApiError } from '../api/client'
import type { Skill } from '../api/types'
import { IconClose } from '../ui/icons'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

interface Props {
  onImported: (s: Skill) => void
  onClose: () => void
}

export function AddSkillModal({ onImported, onClose }: Props) {
  const [method, setMethod] = useState<'git' | 'folder'>('git')
  const [url, setUrl] = useState('')
  const [path, setPath] = useState('')
  const [msg, setMsg] = useState<{ text: string; ok: boolean } | null>(null)
  const [loading, setLoading] = useState(false)
  const urlRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    setTimeout(() => { urlRef.current?.focus() }, 0)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  const switchMethod = (m: 'git' | 'folder') => {
    setMethod(m)
    setMsg(null)
  }

  const handleImport = async () => {
    if (method === 'git') {
      const trimmed = url.trim()
      if (!/^(https?:\/\/|git@).+/.test(trimmed)) {
        setMsg({ text: '✗ 请输入有效的 Git 仓库地址', ok: false })
        return
      }
      try {
        setLoading(true)
        const res = await api.importSkill({ source: 'git', url: trimmed })
        onImported(res.skill)
        onClose()
      } catch (err) {
        setMsg({ text: err instanceof ApiError ? err.message : '✗ 导入失败', ok: false })
      } finally {
        setLoading(false)
      }
    } else {
      const trimmed = path.trim()
      if (!trimmed) {
        setMsg({ text: '✗ 请输入文件夹路径', ok: false })
        return
      }
      try {
        setLoading(true)
        const res = await api.importSkill({ source: 'folder', path: trimmed })
        onImported(res.skill)
        onClose()
      } catch (err) {
        setMsg({ text: err instanceof ApiError ? err.message : '✗ 导入失败', ok: false })
      } finally {
        setLoading(false)
      }
    }
  }

  return (
    <div className="modal-backdrop open" onClick={handleBackdrop}>
      <div className="np-modal" role="dialog" aria-label="添加技能">
        <IconButton variant="modal-close" title="关闭 (Esc)" onClick={onClose}>
          <IconClose size={16} />
        </IconButton>
        <h2 className="np-h">添加技能</h2>
        <p className="np-sub">从 Git 仓库或本地文件夹导入一个 SKILL.md 技能。</p>
        <div className="seg-control" style={{ margin: '6px 0 14px' }}>
          <button
            className={method === 'git' ? 'on' : ''}
            type="button"
            onClick={() => switchMethod('git')}
          >从 Git 导入</button>
          <button
            className={method === 'folder' ? 'on' : ''}
            type="button"
            onClick={() => switchMethod('folder')}
          >导入文件夹</button>
        </div>
        {method === 'git' && (
          <div>
            <div className="field" style={{ marginTop: 0 }}>
              <div className="field-label">Git 仓库地址</div>
              <input
                ref={urlRef}
                className="field-input"
                placeholder="https://github.com/owner/skill-repo.git"
                value={url}
                onChange={e => setUrl(e.target.value)}
              />
              <div className="field-hint">仓库（或其子目录）需含合法 SKILL.md。</div>
            </div>
          </div>
        )}
        {method === 'folder' && (
          <div>
            <div className="field" style={{ marginTop: 0 }}>
              <div className="field-label">本地文件夹</div>
              <div className="field-row">
                <input
                  className="field-input"
                  placeholder="本地文件夹绝对路径，如 /Users/you/skills/my-skill"
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
                >选择文件夹…</button>
              </div>
              <div className="field-hint">所选文件夹需含 SKILL.md（导入时校验）。</div>
            </div>
          </div>
        )}
        {msg !== null && (
          <div className={`ska-msg ${msg.ok ? 'ok' : 'err'}`}>{msg.text}</div>
        )}
        <div className="np-actions">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={handleImport} disabled={loading}>导入</Button>
        </div>
      </div>
    </div>
  )
}
