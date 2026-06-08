import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { EntityRequirement, ProbedSkill, SkillSourceDef } from '../api/types'
import { IconClose } from '../ui/icons'
import { IconButton } from '../ui/IconButton'
import { ConfigPanel } from './ConfigPanel'

interface Props {
  source: SkillSourceDef
  skill: ProbedSkill
  /** 技能库里全部已入库技能（含本源），用于跨源同名预警 */
  allInLibSkills: { name: string; sourceName: string }[]
  onToggled: () => void
  onClose: () => void
}

/**
 * 技能 SKILL.md 预览弹窗（含「加入技能库」开关）。
 * 形态 1:1 对齐原型 openSkillModal（integrations.html L535-561）。
 */
export function SkillMdModal({ source, skill, allInLibSkills, onToggled, onClose }: Props) {
  const [content, setContent] = useState<string | null>(null)
  const [loadErr, setLoadErr] = useState(false)
  // 本地乐观映射 inLib：父组件 reload 会重建并重挂，但开关瞬时反馈用本地态
  const [inLib, setInLib] = useState(skill.inLib)
  const [req, setReq] = useState<EntityRequirement | undefined>(undefined)

  useEffect(() => { setInLib(skill.inLib) }, [skill.inLib])

  useEffect(() => {
    let alive = true
    api.listEntityRequirements().then(r => {
      if (!alive) return
      const key = 'skill:' + (skill.effectiveName ?? skill.name)
      setReq(r.requirements[key])
    }).catch(() => { /* noop */ })
    return () => { alive = false }
  }, [skill.effectiveName, skill.name])

  useEffect(() => {
    let alive = true
    setContent(null)
    setLoadErr(false)
    api.skillSourceMd(source.id, skill.relPath)
      .then(r => { if (alive) setContent(r.content) })
      .catch(() => { if (alive) setLoadErr(true) })
    return () => { alive = false }
  }, [source.id, skill.relPath])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  // 跨源同名预警：其它源（排除本源）里已入库、且同名的技能
  const conflictSources = allInLibSkills
    .filter(s => s.name === skill.name && s.sourceName !== source.name)
    .map(s => s.sourceName)
  const conflicts = Array.from(new Set(conflictSources))

  const handleBackdrop = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) onClose()
  }

  const onToggle = async () => {
    const next = !inLib
    setInLib(next) // 乐观反馈
    try {
      await api.toggleSkillLib({ sourceId: source.id, relPath: skill.relPath, inLib: next })
      onToggled()
    } catch {
      setInLib(!next) // 失败回滚
    }
  }

  return (
    <div className="modal-backdrop open" onClick={handleBackdrop}>
      <div className="skill-md-modal skill-md-modal--cfg" role="dialog" aria-label={skill.name}>
        <div className="smm-head">
          <div className="smm-title-wrap">
            <div className="smm-title">{skill.name}</div>
            <div className="smm-sub">
              <span className="si-src">{source.name}</span>
              <code>{`${skill.relPath}SKILL.md`}</code>
            </div>
          </div>
          <IconButton variant="modal-close" title="关闭 (Esc)" onClick={onClose}>
            <IconClose size={16} />
          </IconButton>
        </div>
        <div className="smm-body smm-body--split">
          <div className="smm-left">
            {conflicts.length > 0 && (
              <div className="smm-dup">
                ⚠ 技能库已有同名技能 <b>{skill.name}</b>（来自 {conflicts.join('、')}）。加入后按源区分共存，注入时自动加源标识区分。
              </div>
            )}
            <pre className="smm-pre">
              {content !== null ? content : loadErr ? '（SKILL.md 读取失败）' : '加载中…'}
            </pre>
          </div>
          <div className="smm-cfg">
            <ConfigPanel
              skill={{ effectiveName: skill.effectiveName, name: skill.name, sourceId: source.id, relPath: skill.relPath }}
              requirement={req}
            />
          </div>
        </div>
        <div className="smm-foot">
          <div className="smm-foot-l">
            <div className="lab">加入技能库</div>
            <div className="desc">开启后此技能进入技能库，可在任务里注入</div>
          </div>
          <button
            className={`toggle${inLib ? ' on' : ''}`}
            type="button"
            aria-pressed={inLib}
            onClick={onToggle}
          />
        </div>
      </div>
    </div>
  )
}
