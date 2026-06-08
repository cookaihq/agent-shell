import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import type { SecretView } from '../api/types'

export const escS = (s: string): string =>
  String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// 备注白名单解析：整段先转义，仅把 <a href="http(s)://…">文字</a> 还原成安全锚点（target=_blank rel=noreferrer）。
export const noteHtml = (t: string): string => {
  const str = String(t)
  const re = /<a href="(https?:\/\/[^"]*)">([^<]*)<\/a>/g
  let out = ''; let last = 0; let m: RegExpExecArray | null
  while ((m = re.exec(str))) {
    out += escS(str.slice(last, m.index))
    out += '<a href="' + escS(m[1]) + '" target="_blank" rel="noreferrer">' + escS(m[2]) + '</a>'
    last = m.index + m[0].length
  }
  return out + escS(str.slice(last))
}

// 引用名美化：技能引用是 entityRef（skill:<effectiveName>），去 skill: 前缀 + 去重名消歧后缀 __s_xxx，显示原始技能名。
const cleanSkillRef = (ref: string): string => ref.replace(/^skill:/, '').replace(/__s_[a-z0-9]+$/i, '')

const KeyIcon = () => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="15" r="4" /><path d="M10.8 12.2 19 4M16 7l3 3M14 9l2 2" /></svg>
)

type EditState = { id: string | 'new'; name: string; value: string; note: string } | null

export function SecretsSettings() {
  const [list, setList] = useState<SecretView[]>([])
  const [usage, setUsage] = useState<Record<string, { skills: string[]; providers: string[] }>>({})
  const [edit, setEdit] = useState<EditState>(null)

  const reload = useCallback(async () => {
    const r = await api.listSecrets()
    setList(r.secrets)
    setUsage(r.usage)
  }, [])

  useEffect(() => { reload() }, [reload])

  async function save() {
    if (!edit || !edit.name.trim()) return
    if (edit.id === 'new') {
      if (!edit.value.trim()) return
      await api.createSecret({ name: edit.name, value: edit.value, note: edit.note || undefined })
    } else {
      await api.updateSecret(edit.id, {
        name: edit.name,
        note: edit.note || undefined,
        ...(edit.value ? { value: edit.value } : {}),
      })
    }
    setEdit(null)
    reload()
  }

  async function remove(id: string) {
    await api.deleteSecret(id)
    if (edit?.id === id) setEdit(null)
    reload()
  }

  // FoxAPI 置顶（对齐原型；播种已让 FoxAPI 先建，显式排序再兜底防用户重排）
  const ordered = [...list].sort((a, b) => (b.name.startsWith('FoxAPI') ? 1 : 0) - (a.name.startsWith('FoxAPI') ? 1 : 0))

  const editor = edit && (
    <div className="sec-form">
      <div className="field">
        <div className="field-label">名称 <span className="req">*</span></div>
        <input className="field-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="如 高德地图 Key" />
      </div>
      <div className="field">
        <div className="field-label">密钥值 <span className="req">*</span></div>
        <input className="field-input" type="password" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} placeholder={edit.id === 'new' ? '粘贴密钥/Token' : '留空不修改'} />
      </div>
      <div className="field">
        <div className="field-label">备注 <span className="field-opt">可选</span></div>
        <input className="field-input" value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} placeholder='用途说明（可含 <a href="https://…">获取密钥</a> 链接）' />
      </div>
      <div className="sec-form-acts">
        <button className="btn-ghost" type="button" onClick={() => setEdit(null)}>取消</button>
        <button className="btn-primary2" type="button" onClick={save}>{edit.id === 'new' ? '创建' : '保存'}</button>
      </div>
    </div>
  )

  return (
    <>
      <p className="set-kicker">设置</p>
      <h2 className="set-h">密钥管理</h2>
      <p className="set-sub">集中管理技能用到的密钥/凭证。一个密钥可被多个技能共用；具体「哪个技能用哪个密钥」在「集成 › 技能」里打开某技能、于右栏绑定。密钥仅以 0600 权限明文存于本机。</p>

      <div className="sec-top">
        <span className="set-kicker" style={{ margin: 0 }}>命名密钥（{list.length}）</span>
        {!edit && (
          <button className="btn-primary2" type="button" onClick={() => setEdit({ id: 'new', name: '', value: '', note: '' })}>＋ 新建密钥</button>
        )}
      </div>

      {editor}

      <div className="sec-list">
        {ordered.map((s) => {
          const u = usage[s.id] ?? { skills: [], providers: [] }
          const refs = [...u.skills.map(cleanSkillRef), ...u.providers]
          return (
            <div className="sec-row" key={s.id}>
              <span className="sec-ic"><KeyIcon /></span>
              <div className="sec-main">
                <div className="sec-name">
                  {s.name}
                  {s.note && <span className="sec-note" dangerouslySetInnerHTML={{ __html: ' · ' + noteHtml(s.note) }} />}
                </div>
                <div className="sec-val">
                  {s.hasValue
                    ? <code>{s.maskedValue}</code>
                    : <span className="sec-unset">未配置</span>}
                </div>
                <div className="sec-used">
                  {refs.length > 0
                    ? <>被 <b>{refs.length}</b> 个技能引用：{refs.join('、')}</>
                    : <span className="none">暂无技能引用</span>}
                </div>
              </div>
              <div className="sec-acts">
                <button className="sec-btn" type="button" onClick={() => setEdit({ id: s.id, name: s.name, value: '', note: s.note ?? '' })}>编辑</button>
                <button className="sec-btn sec-btn--danger" type="button" onClick={() => remove(s.id)}>删除</button>
              </div>
            </div>
          )
        })}
      </div>
    </>
  )
}
