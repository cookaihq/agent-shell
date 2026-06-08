import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { SecretView, ReqSlot, EntityRequirement } from '../api/types'

interface SkillRef {
  effectiveName?: string
  name?: string
  sourceId: string
  relPath: string
}

interface Props {
  skill: SkillRef
  requirement?: EntityRequirement
}

export function ConfigPanel({ skill, requirement }: Props) {
  const ref = 'skill:' + (skill.effectiveName ?? skill.name ?? '')

  const [slots, setSlots] = useState<ReqSlot[] | undefined>(requirement?.slots)
  const [slotsSource, setSlotsSource] = useState<'declared' | 'agent' | 'manual' | null>(
    requirement?.slotsSource ?? null
  )
  const [secrets, setSecrets] = useState<SecretView[]>([])
  const [probing, setProbing] = useState(false)
  const [newSecFor, setNewSecFor] = useState<string | null>(null)
  const [newSecName, setNewSecName] = useState('')
  const [newSecVal, setNewSecVal] = useState('')

  useEffect(() => {
    api.listSecrets().then(r => setSecrets(r.secrets))
  }, [])

  async function save(nextSlots: ReqSlot[], nextSource: 'declared' | 'agent' | 'manual' | null) {
    await api.putEntityRequirements(ref, {
      needsConfig: nextSlots.length > 0,
      slotsSource: nextSource,
      slots: nextSlots,
    })
  }

  async function handleReprobe() {
    setProbing(true)
    try {
      const r = await api.probeSkillConfig({ sourceId: skill.sourceId, relPath: skill.relPath })
      const newSlots = r.slots
      const newSource = 'agent'
      setSlots(newSlots)
      setSlotsSource(newSource)
      await save(newSlots, newSource)
    } finally {
      setProbing(false)
    }
  }

  async function handleBindChange(slotIdx: number, value: string) {
    if (!slots) return
    if (value === '__new__') {
      setNewSecFor(slots[slotIdx].name)
      // find default for prefill
      const slot = slots[slotIdx]
      setNewSecVal(slot.default ?? '')
      setNewSecName('')
      return
    }
    const nextSlots = slots.map((s, i) =>
      i === slotIdx ? { ...s, bind: value || null } : s
    )
    setSlots(nextSlots)
    const nextSource: 'manual' = 'manual'
    setSlotsSource(nextSource)
    await save(nextSlots, nextSource)
  }

  async function handleCreateAndBind(slotIdx: number) {
    if (!slots) return
    if (!newSecName.trim() || !newSecVal.trim()) return
    const r = await api.createSecret({ name: newSecName.trim(), value: newSecVal.trim() })
    const newSecret = r.secret
    setSecrets(prev => [...prev, newSecret])
    const nextSlots = slots.map((s, i) =>
      i === slotIdx ? { ...s, bind: newSecret.id } : s
    )
    setSlots(nextSlots)
    setSlotsSource('manual')
    setNewSecFor(null)
    setNewSecName('')
    setNewSecVal('')
    await save(nextSlots, 'manual')
  }

  const reprobeBtn = (
    <button
      className="cfg-reprobe"
      type="button"
      disabled={probing}
      onClick={handleReprobe}
    >
      {probing ? '探测中…' : '🔍 重新探测'}
    </button>
  )

  const head = (
    <div className="smm-cfg-head">
      <div className="smm-cfg-title">配置</div>
      {reprobeBtn}
    </div>
  )

  // 未探测态
  if (slots === undefined) {
    return (
      <div className="smm-cfg">
        {head}
        <div className="cfg-empty">
          尚未探测。点「重新探测」让 Agent 读 SKILL.md 与脚本，列出需要的密钥/配置。
        </div>
      </div>
    )
  }

  // 无需配置态
  if (slots.length === 0) {
    return (
      <div className="smm-cfg">
        {head}
        <div className="cfg-empty cfg-empty--ok">✓ 无需配置 —— 此技能不读取任何密钥或外部配置。</div>
      </div>
    )
  }

  // 有槽位
  const needCount = slots.filter(s => !s.bind).length
  const statClass = needCount > 0 ? 'cfg-stat is-need' : 'cfg-stat is-done'
  const statText = needCount > 0
    ? `探测到 ${slots.length} 项配置，${needCount} 项待绑定`
    : `✓ ${slots.length} 项已全部配置`

  return (
    <div className="smm-cfg">
      {head}
      <div className={statClass}>{statText}</div>
      <div className="cfg-rows">
        {slots.map((slot, i) => {
          const typeLab = slot.kind === 'file' ? '配置文件' : '环境变量'
          const isNewSecOpen = newSecFor === slot.name
          return (
            <div key={slot.name} className={'cfg-row' + (slot.bind ? ' is-bound' : '')}>
              <div className="cfg-row-top">
                <span className="cfg-kind">{typeLab}</span>
                <code className="cfg-name">{slot.name}</code>
                {slot.bind
                  ? <span className="cfg-ok">✓ 已绑定</span>
                  : <span className="cfg-warn">未绑定</span>}
              </div>
              <select
                className="field-select cfg-bind"
                value={slot.bind ?? ''}
                onChange={e => handleBindChange(i, e.target.value)}
              >
                <option value="">— 选择密钥 —</option>
                {secrets.map(sec => (
                  <option key={sec.id} value={sec.id}>{sec.name}</option>
                ))}
                <option value="__new__">+ 新建密钥…</option>
              </select>
              {!slot.bind && slot.default && (
                <div className="cfg-default">默认值 <code>{slot.default}</code>（可直接采用）</div>
              )}
              {isNewSecOpen && (
                <div className="cfg-newsec">
                  <input
                    className="field-input cfg-ns-name"
                    placeholder="密钥名称（如 高德 Key）"
                    value={newSecName}
                    onChange={e => setNewSecName(e.target.value)}
                  />
                  <input
                    className="field-input cfg-ns-val"
                    placeholder="密钥值"
                    value={newSecVal}
                    onChange={e => setNewSecVal(e.target.value)}
                  />
                  <button
                    className="cfg-ns-add btn-primary2"
                    type="button"
                    onClick={() => handleCreateAndBind(i)}
                  >
                    创建并绑定
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
