// NewProjectModal — 1:1 对照原型 app.js openNewProject (L270-296)
// 结构: .modal-backdrop.open > .np-modal[role=dialog]
//   modal-close (×) | np-h | np-sub
//   field: 项目名称 input
//   field: 存储位置 (readOnly 父级目录展示，仅显示不可改——改父级目录走「系统设置」)
//   np-actions: 取消 + 创建项目

import { useEffect, useState } from 'react'
import { api } from '../api/client'
import { IconClose } from '../ui/icons'
import { Button } from '../ui/Button'
import { IconButton } from '../ui/IconButton'

interface NewProjectModalProps {
  onClose: () => void
  onCreated: (projectId: string) => void
}

export function NewProjectModal({ onClose, onCreated }: NewProjectModalProps) {
  const [name, setName] = useState('')
  // 只展示父级存储位置（真实配置的 projectsDir）——具体项目目录名后端创建时自行生成
  const [parentDir, setParentDir] = useState('~/AgentShell/projects')
  const [creating, setCreating] = useState(false)

  // 拉取系统设置里配置的父级目录
  useEffect(() => {
    let alive = true
    api.getConfig().then((cfg) => { if (alive) setParentDir(cfg.projectsDir) }).catch(() => {})
    return () => { alive = false }
  }, [])

  // Esc 关闭
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [onClose])

  async function create() {
    const trimmed = name.trim() || '未命名项目'
    setCreating(true)
    try {
      const res = await api.createProject(trimmed)
      onCreated(res.projectId)
    } finally {
      setCreating(false)
    }
  }

  return (
    <div
      className="modal-backdrop open"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="np-modal" role="dialog" aria-label="新建项目">
        <IconButton variant="modal-close" title="关闭 (Esc)" onClick={onClose}>
          <IconClose size={16} />
        </IconButton>
        <h2 className="np-h">新建项目</h2>
        <p className="np-sub">在数据目录下创建一个新的项目文件夹。</p>

        <div className="field">
          <div className="field-label">项目名称</div>
          <input
            className="field-input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="未命名项目"
            autoFocus
          />
        </div>

        <div className="field">
          <div className="field-label">存储位置</div>
          <div className="field-static">{parentDir}</div>
          <div className="field-hint">项目将创建在此父级目录下，目录名由系统自动生成。父级目录可在「系统设置」修改。</div>
        </div>

        <div className="np-actions">
          <Button variant="ghost" onClick={onClose}>取消</Button>
          <Button variant="primary" onClick={create} disabled={creating}>
            创建项目
          </Button>
        </div>
      </div>
    </div>
  )
}
