import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import type { Engine } from '../api/types'
import type { ProviderView, ProviderKeyEnv, TestProviderRes } from '../api/types'

type EditState = { id: string | 'new'; name: string; baseUrl: string; apiKey: string; keyEnv: ProviderKeyEnv } | null
type TestState = { id: string; phase: 'loading' | 'done'; res?: TestProviderRes } | null

export function ProviderSection({ engine, model }: { engine: Engine; model?: string }) {
  const [active, setActive] = useState('default')
  const [list, setList] = useState<ProviderView[]>([])
  const [edit, setEdit] = useState<EditState>(null)
  const [test, setTest] = useState<TestState>(null)
  const [showKey, setShowKey] = useState(false)

  const reload = useCallback(async () => {
    const r = await api.listProviders()
    setActive(r.engines[engine].active)
    setList(r.engines[engine].providers)
  }, [engine])
  useEffect(() => { setEdit(null); setTest(null); reload() }, [engine, reload])

  if (engine !== 'claude') {
    return (
      <div className="set-card" style={{ marginTop: 14 }}>
        <div className="model-head">上游 Provider：<b>Codex CLI</b></div>
        <div className="field-hint">codex 的上游 Provider 将在后续版本支持（见 spec §12）。</div>
      </div>
    )
  }

  async function pick(id: string) {
    try { await api.setActiveProvider('claude', id); setActive(id) }
    catch { reload() }   // 失败 → 回拉服务端真值，避免 UI 与服务端发散
  }
  async function runTest(id: string) {
    setTest({ id, phase: 'loading' })
    try {
      const res = await api.testProvider(id, model)
      setTest({ id, phase: 'done', res })
    } catch (e) {
      setTest({ id, phase: 'done', res: { ok: false, requestText: '', responseText: '测试请求失败：' + String(e) } })
    }
  }
  async function save() {
    if (!edit || !edit.name.trim() || !edit.baseUrl.trim()) return
    if (edit.id === 'new') {
      const { provider } = await api.createProvider({ engine: 'claude', name: edit.name, baseUrl: edit.baseUrl, apiKey: edit.apiKey, keyEnv: edit.keyEnv })
      await api.setActiveProvider('claude', provider.id)
    } else {
      await api.updateProvider(edit.id, { name: edit.name, baseUrl: edit.baseUrl, keyEnv: edit.keyEnv, ...(edit.apiKey ? { apiKey: edit.apiKey } : {}) })
    }
    setEdit(null); reload()
  }
  async function remove(id: string) {
    try { await api.deleteProvider(id) } catch { /* 失败也回拉同步 */ }
    if (edit?.id === id) setEdit(null)
    reload()
  }

  const editor = edit && (
    <div className="model-editor">
      <div className="me-title">{edit.id === 'new' ? '添加 Provider' : '编辑 Provider'}</div>
      <div className="me-row"><label className="me-label">名称</label>
        <input className="field-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="如 我的中转站 / 公司网关" /></div>
      <div className="me-row"><label className="me-label">Base URL</label>
        <input className="field-input" value={edit.baseUrl} onChange={(e) => setEdit({ ...edit, baseUrl: e.target.value })} placeholder="https://api.example.com" /></div>
      <div className="me-row"><label className="me-label">API Key</label>
        <div className="field-row">
          <input className="field-input" type={showKey ? 'text' : 'password'} value={edit.apiKey}
            onChange={(e) => setEdit({ ...edit, apiKey: e.target.value })}
            placeholder={edit.id === 'new' ? '填写该 Provider 的密钥' : '留空表示不修改'} />
          <button className="field-btn" type="button" onClick={() => setShowKey((v) => !v)}>{showKey ? '隐藏' : '显示'}</button>
        </div></div>
      <div className="me-row"><label className="me-label">凭证类型</label>
        <div className="seg-control">
          <button className={edit.keyEnv === 'api_key' ? 'on' : ''} type="button" onClick={() => setEdit({ ...edit, keyEnv: 'api_key' })}>API Key</button>
          <button className={edit.keyEnv === 'auth_token' ? 'on' : ''} type="button" onClick={() => setEdit({ ...edit, keyEnv: 'auth_token' })}>Auth Token</button>
        </div>
        <span className="field-hint">官方 / 兼容 x-api-key 选 API Key；多数第三方中转选 Auth Token。</span></div>
      <div className="me-actions">
        {edit.id !== 'new' && <button className="me-btn danger" type="button" onClick={() => remove(edit.id)}>删除</button>}
        <span className="me-sp" />
        <button className="me-btn" type="button" onClick={() => setEdit(null)}>取消</button>
        <button className="me-btn primary" type="button" onClick={save}>保存</button>
      </div>
    </div>
  )

  const panel = (id: string) => test && test.id === id && (
    test.phase === 'loading'
      ? <div className="prov-test-panel"><div className="ptp-head">测试 · 正在调用上游…</div></div>
      : <div className={`prov-test-panel ${test.res!.ok ? 'is-ok' : 'is-err'}`}>
          <div className="ptp-head">{test.res!.ok ? '✓ 连通成功' : '✗ 测试失败'}<button className="ptp-x" type="button" onClick={() => setTest(null)}>×</button></div>
          <div className="ptp-sec"><div className="ptp-label">请求（密钥已掩码）</div><pre className="ptp-pre">{test.res!.requestText}</pre></div>
          <div className="ptp-sec"><div className="ptp-label">响应{test.res!.status ? ' · HTTP ' + test.res!.status : ''}</div><pre className="ptp-pre">{test.res!.responseText}</pre></div>
        </div>
  )

  const item = (id: string, name: string, sub: string, actions?: React.ReactNode) => (
    <div className="prov-block" key={id}>
      <div className="prov-row">
        <button className={`prov-item${active === id ? ' on' : ''}`} type="button" onClick={() => pick(id)}>
          <span className="prov-radio" /><span className="prov-meta"><span className="prov-name">{name}</span><span className="prov-sub">{sub}</span></span>
        </button>
        {actions}
      </div>
      {panel(id)}
    </div>
  )

  return (
    <div className="set-card" style={{ marginTop: 14 }}>
      <div className="model-head">上游 Provider：<b>Claude Code</b></div>
      <div className="field-hint" style={{ margin: '-4px 0 12px' }}>选择该引擎走哪个上游。「默认」走 CLI 自己的登录态；自定义则把上游地址 + 密钥注入本机 CLI 进程——不改写你的全局配置。</div>
      <div className="prov-list">
        {item('default', '默认（CLI 登录态）', '不注入凭证，走 CLI 自己的登录')}
        {list.map((p) => item(p.id, p.name, `${p.baseUrl} · ${p.keyEnv === 'auth_token' ? 'Auth Token' : 'API Key'}`,
          <div className="prov-actions">
            <button className="prov-act" type="button" onClick={() => runTest(p.id)}>测试</button>
            <button className="prov-act" type="button" onClick={() => setEdit({ id: p.id, name: p.name, baseUrl: p.baseUrl, apiKey: '', keyEnv: p.keyEnv })}>编辑</button>
            <button className="prov-act danger" type="button" onClick={() => remove(p.id)}>删除</button>
          </div>))}
      </div>
      {edit ? editor : <button className="prov-add" type="button" onClick={() => { setShowKey(false); setEdit({ id: 'new', name: '', baseUrl: '', apiKey: '', keyEnv: 'auth_token' }) }}>＋ 添加 Provider</button>}
    </div>
  )
}
