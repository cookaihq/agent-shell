import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import type { ProxyView, ProxyProtocol, ProxyTestResult } from '../api/types'

const PROTO_OPTS: ProxyProtocol[] = ['http', 'https', 'socks5', 'socks5h']

type EditState = { id: string | 'new'; name: string; protocol: ProxyProtocol; host: string; port: string; username: string; password: string } | null
type TestState = { phase: 'loading' } | ({ phase: 'done' } & ProxyTestResult) | undefined

function addrText(p: ProxyView): string {
  const auth = p.username ? `${p.username}:••••@` : ''
  return `${p.protocol}://${auth}${p.host}:${p.port}`
}

export function ProxySettings() {
  const [list, setList] = useState<ProxyView[]>([])
  const [edit, setEdit] = useState<EditState>(null)
  const [tests, setTests] = useState<Record<string, TestState>>({})

  const reload = useCallback(async () => {
    const r = await api.listProxies()
    setList(r.proxies)
  }, [])

  useEffect(() => { reload() }, [reload])

  async function save() {
    if (!edit) return
    const name = edit.name.trim()
    const host = edit.host.trim()
    const port = parseInt(edit.port.trim(), 10)
    if (!name || !host || !Number.isFinite(port)) return
    const body = {
      name,
      protocol: edit.protocol,
      host,
      port,
      ...(edit.username.trim() ? { username: edit.username.trim() } : {}),
      ...(edit.password.trim() ? { password: edit.password.trim() } : {}),
    }
    if (edit.id === 'new') await api.createProxy(body)
    else await api.updateProxy(edit.id, body)
    setEdit(null)
    reload()
  }

  async function remove(id: string) {
    await api.deleteProxy(id)
    if (edit?.id === id) setEdit(null)
    reload()
  }

  async function runTest(id: string) {
    setTests((prev) => ({ ...prev, [id]: { phase: 'loading' } }))
    try {
      const res = await api.testProxy(id)
      setTests((prev) => ({ ...prev, [id]: { phase: 'done', ...res } }))
    } catch (e) {
      setTests((prev) => ({ ...prev, [id]: { phase: 'done', ok: false, error: String(e) } }))
    }
  }

  function openEdit(p?: ProxyView) {
    if (!p) setEdit({ id: 'new', name: '', protocol: 'socks5', host: '', port: '', username: '', password: '' })
    else setEdit({ id: p.id, name: p.name, protocol: p.protocol, host: p.host, port: String(p.port), username: p.username ?? '', password: '' })
  }

  function latencyHtml(id: string) {
    const t = tests[id]
    if (!t) return <span className="proxy-latency testing">未测试</span>
    if (t.phase === 'loading') return <span className="proxy-latency testing">测试中…</span>
    if (t.ok) return <span className="proxy-latency">{t.latencyMs != null ? `${t.latencyMs} ms` : '连通'}</span>
    return <span className="proxy-latency err" title={t.error}>失败</span>
  }

  const editor = edit && (
    <div className="proxy-editor">
      <div className="me-title">{edit.id === 'new' ? '添加代理' : '编辑代理'}</div>
      <div className="me-row"><label className="me-label">名称</label>
        <input className="field-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="如 主力梯子" /></div>
      <div className="me-row"><label className="me-label">协议</label>
        <div className="seg-control">
          {PROTO_OPTS.map((pt) => (
            <button key={pt} className={edit.protocol === pt ? 'on' : ''} type="button" onClick={() => setEdit({ ...edit, protocol: pt })}>{pt}</button>
          ))}
        </div></div>
      <div className="me-row"><label className="me-label">主机</label>
        <input className="field-input" value={edit.host} onChange={(e) => setEdit({ ...edit, host: e.target.value })} placeholder="127.0.0.1 或 proxy.example.com" /></div>
      <div className="me-row"><label className="me-label">端口</label>
        <input className="field-input" value={edit.port} onChange={(e) => setEdit({ ...edit, port: e.target.value })} placeholder="7890" style={{ maxWidth: 120 }} /></div>
      <div className="me-row"><label className="me-label">用户名 <span className="field-opt">可选</span></label>
        <input className="field-input" value={edit.username} onChange={(e) => setEdit({ ...edit, username: e.target.value })} placeholder="留空=匿名" /></div>
      <div className="me-row"><label className="me-label">密码 <span className="field-opt">可选</span></label>
        <input className="field-input" type="password" value={edit.password} onChange={(e) => setEdit({ ...edit, password: e.target.value })} placeholder={edit.id === 'new' ? '留空=无密码' : '留空=保留原密码'} /></div>
      <div className="me-actions">
        {edit.id !== 'new' && <button className="me-btn danger" type="button" onClick={() => remove(edit.id)}>删除</button>}
        <span className="me-sp" />
        <button className="me-btn" type="button" onClick={() => setEdit(null)}>取消</button>
        <button className="me-btn primary" type="button" onClick={save}>保存</button>
      </div>
    </div>
  )

  return (
    <div className="set-card" style={{ marginTop: 14 }}>
      <div className="sec-top">
        <span className="model-head">代理池（{list.length}）</span>
        {!edit && <button className="prov-add" type="button" style={{ width: 'auto' }} onClick={() => openEdit()}>＋ 添加代理</button>}
      </div>
      <div className="field-hint" style={{ margin: '-4px 0 12px' }}>
        为登录 / 上游请求配置代理；在「上游 Provider」里把某个来源绑定到这里的代理。cli-login 复用本机 CLI，不走代理。
      </div>
      {editor}
      <div className="proxy-list">
        {list.map((p) => {
          const t = tests[p.id]
          const active = t?.phase === 'done' ? t.ok : p.status === 'active'
          return (
            <div className="proxy-row" key={p.id}>
              <span className={`proxy-stat${active ? ' active' : ''}`} />
              <span className="proxy-name">{p.name}</span>
              <code className="proxy-addr">{addrText(p)}</code>
              {latencyHtml(p.id)}
              <div className="proxy-actions">
                <button className="proxy-act" type="button" onClick={() => runTest(p.id)}>测试</button>
                <button className="proxy-act" type="button" onClick={() => openEdit(p)}>编辑</button>
                <button className="proxy-act danger" type="button" onClick={() => remove(p.id)}>删除</button>
              </div>
            </div>
          )
        })}
        {list.length === 0 && !edit && (
          <button className="proxy-add" type="button" onClick={() => openEdit()}>＋ 添加代理</button>
        )}
      </div>
    </div>
  )
}
