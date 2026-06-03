import React, { useEffect, useRef, useState } from 'react'
import { api } from '../api/client'
import { Button } from '../ui/Button'

export function SystemSettings() {
  const [projectsDir, setProjectsDir] = useState('')
  const [skillsDir, setSkillsDir] = useState('')
  const [saved, setSaved] = useState(false)
  const projectsDirRef = useRef<HTMLInputElement>(null)
  const skillsDirRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    api.getConfig().then(cfg => {
      setProjectsDir(cfg.projectsDir)
      setSkillsDir(cfg.skillsDir)
    })
  }, [])

  async function pickInto(setter: (v: string) => void, fallbackRef: React.RefObject<HTMLInputElement>) {
    const bridge = window.agentShell
    if (bridge) {
      const dir = await bridge.pickFolder()
      if (dir) { setter(dir); setSaved(false) }
    } else {
      fallbackRef.current?.focus()  // 浏览器/dev 回退：仍可手输
    }
  }

  async function handleSave() {
    try {
      await api.saveConfig({ projectsDir, skillsDir })
      setSaved(true)
    } catch {
      // keep it simple
    }
  }

  return (
    <>
      <p className="set-kicker">设置</p>
      <h2 className="set-h">系统设置</h2>
      <p className="set-sub">应用数据文件的存放位置。</p>
      <div className="set-card">
        <div className="field" style={{ marginTop: '2px' }}>
          <div className="field-label">项目父级目录</div>
          <div className="field-row">
            <input
              className="field-input"
              id="dataDir"
              ref={projectsDirRef}
              value={projectsDir}
              onChange={e => { setProjectsDir(e.target.value); setSaved(false) }}
            />
            <button
              className="field-btn"
              type="button"
              onClick={() => pickInto(setProjectsDir, projectsDirRef)}
            >更改…</button>
          </div>
          <div className="field-hint">新建项目时，会在此目录下创建一个以 32 位 ID 命名的子文件夹（如 <code>…/3f2a9c1d4b7e08f5a6c2d9e0b1f3a8c9/</code>）。</div>
        </div>
        <div className="field" style={{ marginBottom: '2px' }}>
          <div className="field-label">技能库目录</div>
          <div className="field-row">
            <input
              className="field-input"
              id="skillDir"
              ref={skillsDirRef}
              value={skillsDir}
              onChange={e => { setSkillsDir(e.target.value); setSaved(false) }}
            />
            <button
              className="field-btn"
              type="button"
              onClick={() => pickInto(setSkillsDir, skillsDirRef)}
            >更改…</button>
          </div>
          <div className="field-hint">「添加技能」导入的 SKILL.md 技能存放于此。</div>
        </div>
      </div>
      <div className="set-actions" style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 14 }}>
        <Button variant="primary" onClick={handleSave}>保存</Button>
        {saved && <span className="saved-pill">已保存</span>}
      </div>
    </>
  )
}
