import { useEffect, useState, useCallback } from 'react'
import { api } from '../api/client'
import type { Engine } from '../api/types'
import type { ProviderView, ProviderKeyEnv, ProviderWireApi, TestProviderRes, ProviderModel, SecretView, CliLoginStatus, ProxyView } from '../api/types'
import { CLI_MODELS, AGENT_LABEL } from '../workspace/runtimeState'
import { resolveModelDisplay } from '../workspace/modelDisplay'

// 密钥来源走密钥库选择器：secretId = 选中的密钥 id（''=未选 / '__new__'=手动新建模式），newKeyName/newKeyVal 为手动新建时的草稿
type EditState = { id: string | 'new'; name: string; baseUrl: string; secretId: string; newKeyName: string; newKeyVal: string; keyEnv: ProviderKeyEnv; wireApi: ProviderWireApi; models: ProviderModel[]; defaultModel: string } | null
type TestState = { id: string; phase: 'loading' | 'done'; res?: TestProviderRes } | null

type EditModels = { models: ProviderModel[]; defaultModel: string }
type EditModelsAction = { type: 'add'; value: string; label?: string } | { type: 'del'; value: string } | { type: 'setDefault'; value: string }

/** 编辑表单内「支持的模型」草稿增删改（纯函数，便于测 + 重渲染不丢值）。 */
export function editModelsReducer(s: EditModels, a: EditModelsAction): EditModels {
  if (a.type === 'add') {
    const v = a.value.trim()
    if (!v || s.models.some((m) => m.value === v)) return s
    const lbl = a.label?.trim() || v
    const models = [...s.models, { value: v, label: lbl }]
    return { models, defaultModel: s.defaultModel || v }
  }
  if (a.type === 'del') {
    const models = s.models.filter((m) => m.value !== a.value)
    const defaultModel = s.defaultModel === a.value ? (models[0]?.value ?? '') : s.defaultModel
    return { models, defaultModel }
  }
  return { ...s, defaultModel: a.value }
}

// 官方组品牌名（标题「官方 · {brand}」+ 文案）
const OFFICIAL_BRAND: Record<Engine, string> = { claude: 'Anthropic', codex: 'OpenAI' }
const CLI_NAME: Record<Engine, string> = { claude: 'Claude Code', codex: 'Codex' }

export function ProviderSection({ engine, model }: { engine: Engine; model?: string }) {
  const [list, setList] = useState<ProviderView[]>([])
  const [edit, setEdit] = useState<EditState>(null)
  const [test, setTest] = useState<TestState>(null)
  const [showKey, setShowKey] = useState(false)
  const [secrets, setSecrets] = useState<SecretView[]>([])
  const [adding, setAdding] = useState(false)
  const [addingAlias, setAddingAlias] = useState('')
  const [engineDefault, setEngineDefault] = useState('')
  const [modelAliases, setModelAliases] = useState<Record<Engine, Record<string, string>>>({} as Record<Engine, Record<string, string>>)
  // aliasEditing：当前正在编辑别名的官方 chip value（null=无）
  const [aliasEditing, setAliasEditing] = useState<string | null>(null)
  // 凭证来源（Task 2.3 api）：当前生效来源 + 官网 API Key 引用的 secretId
  const [activeSource, setActiveSource] = useState<string>('cli-login')
  // 本机 CLI 登录态（Task 3.1 api）：cli-login 选项的三态显示数据来源
  const [cliLogin, setCliLogin] = useState<CliLoginStatus | undefined>()
  // 官网 API Key 选择器内进行中的选择（secretId / '__new__' / ''）+ 手动新建草稿
  const [officialKeyDraft, setOfficialKeyDraft] = useState<string>('')
  const [officialNewName, setOfficialNewName] = useState('')
  const [officialNewVal, setOfficialNewVal] = useState('')
  // OAuth 授权登录（Task 4.3 · 3 步粘码流）：进行中的会话（authorizeUrl/state）+ 授权码草稿 + 忙/错状态
  const [oauthFlow, setOauthFlow] = useState<{ authorizeUrl?: string; state?: string; code: string; busy?: boolean; error?: string }>({ code: '' })
  // app 内 OAuth 已登录态——来自 /auth/status 的 oauth 字段（token 持久化在 auth.json），故重开设置/切引擎仍保留
  const [oauthSignedIn, setOauthSignedIn] = useState(false)
  const [oauthEmail, setOauthEmail] = useState<string | undefined>()
  // 代理池（绑定下拉的选项）+ 每来源代理绑定（source → proxyId；空=直连）
  const [proxies, setProxies] = useState<ProxyView[]>([])
  const [proxyBindings, setProxyBindings] = useState<Record<string, string>>({})
  // codex 授权登录（P7.4，app-server 自管 chatgpt OAuth；与 claude 粘码流不同）：进行中会话 + 忙/错
  const [codexLogin, setCodexLogin] = useState<{ authUrl?: string; sessionId?: string; busy?: boolean; error?: string; done?: boolean }>({})

  const reload = useCallback(async () => {
    const r = await api.listProviders()
    setList(r.engines[engine].providers)
  }, [engine])

  const reloadAuth = useCallback(async () => {
    const r = await api.getAuthStatus()
    const e = r.engines[engine]
    setActiveSource(e.activeSource)
    setOfficialKeyDraft(e.officialKey.secretId ?? '')
    setCliLogin(e.cliLogin)
    setOauthSignedIn(e.oauth.signedIn)
    setOauthEmail(e.oauth.email)
    setProxyBindings(e.proxyBindings ?? {})
  }, [engine])

  // 代理池（供每来源绑定下拉列出可选代理）
  const loadProxies = useCallback(() => {
    api.listProxies().then((r) => setProxies(r.proxies)).catch(() => {})
  }, [])
  useEffect(() => { loadProxies() }, [loadProxies])

  useEffect(() => {
    setEdit(null); setTest(null); setOfficialNewName(''); setOfficialNewVal(''); setOauthFlow({ code: '' }); setCodexLogin({}); reload(); reloadAuth()
  }, [engine, reload, reloadAuth])

  // 密钥库（供 API Key 选择器列出已有密钥）
  const loadSecrets = useCallback(() => {
    api.listSecrets().then((r) => setSecrets(r.secrets)).catch(() => {})
  }, [])
  useEffect(() => { loadSecrets() }, [loadSecrets])

  useEffect(() => {
    api.getConfig().then((c) => {
      setEngineDefault(c.engineModels?.[engine as keyof typeof c.engineModels] ?? '')
      setModelAliases((c.modelAliases ?? {}) as Record<Engine, Record<string, string>>)
    }).catch(() => {})
  }, [engine])

  // 默认模型集（引擎官方列表，排除占位项 value==='default'）
  const defaultModelSet = (): ProviderModel[] =>
    (CLI_MODELS[engine] ?? []).filter((m) => m.value !== 'default').map((m) => ({ value: m.value, label: m.label }))

  function openEdit(p?: ProviderView) {
    setShowKey(false); setAdding(false)
    if (!p) {
      const ms = defaultModelSet()
      setEdit({ id: 'new', name: '', baseUrl: '', secretId: '', newKeyName: '', newKeyVal: '', keyEnv: 'auth_token', wireApi: 'responses', models: ms, defaultModel: ms[0]?.value ?? '' })
    } else {
      setEdit({ id: p.id, name: p.name, baseUrl: p.baseUrl, secretId: p.apiKeySecretId ?? '', newKeyName: '', newKeyVal: '', keyEnv: p.keyEnv, wireApi: p.wireApi ?? 'responses', models: p.models ?? [], defaultModel: p.defaultModel ?? (p.models?.[0]?.value ?? '') })
    }
  }

  async function pick(id: string) {
    // 选自定义 Provider：setActiveProvider 同时更新来源归属，回拉凭证状态刷新高亮
    try { await api.setActiveProvider(engine, id); await reloadAuth() }
    catch { reload(); reloadAuth() }
  }

  // 切换官方组来源（cli-login / oauth / official-key）→ 写来源后回拉凭证状态
  async function pickSource(source: string) {
    try { await api.setAuthSource(engine, source); await reloadAuth() }
    catch { reloadAuth() }
  }

  // 把某来源绑定到某代理（proxyId 空串=解绑=直连）→ 回拉凭证状态刷新绑定
  async function bindProxy(source: string, proxyId: string) {
    try { await api.setSourceProxy(engine, source, proxyId); await reloadAuth() }
    catch { reloadAuth() }
  }

  // 官网 API Key：手动新建则先入密钥库取回 id，再 setOfficialKey；选已有直接 setOfficialKey
  async function saveOfficialKey() {
    let secretId = officialKeyDraft
    if (secretId === '__new__') {
      if (!officialNewName.trim() || !officialNewVal.trim()) return
      const { secret } = await api.createSecret({ name: officialNewName.trim(), value: officialNewVal.trim() })
      secretId = secret.id
      loadSecrets()
    }
    if (!secretId) return
    await api.setOfficialKey(engine, secretId)
    setOfficialNewName(''); setOfficialNewVal('')
    await reloadAuth()
  }

  // OAuth 步骤 1：生成授权 URL（拿回 authorizeUrl + state 暂存于本地 flow）
  async function genOAuthUrl() {
    setOauthFlow((f) => ({ ...f, busy: true, error: undefined }))
    try {
      const { authorizeUrl, state } = await api.startOAuth(engine)
      setOauthFlow((f) => ({ ...f, authorizeUrl, state, busy: false }))
    } catch (e) {
      setOauthFlow((f) => ({ ...f, busy: false, error: '生成授权 URL 失败：' + (e instanceof Error ? e.message : String(e)) }))
    }
  }
  // OAuth 步骤 3：用粘贴的授权码 + 发起时的 state 换 token；
  // 乐观本地置已登录（即时反馈）后 reloadAuth() 拉服务端真值——持久化真相在服务端 oauth 字段（token 落 auth.json）
  async function confirmOAuth() {
    const code = oauthFlow.code.trim()
    if (!code || !oauthFlow.state) return
    setOauthFlow((f) => ({ ...f, busy: true, error: undefined }))
    try {
      const { email } = await api.finishOAuth(engine, code, oauthFlow.state)
      setOauthSignedIn(true); setOauthEmail(email)   // 乐观更新
      setOauthFlow({ code: '' })
      await reloadAuth()   // 拉服务端真值（重开/切引擎仍保留的来源）
    } catch (e) {
      setOauthFlow((f) => ({ ...f, busy: false, error: '授权失败：' + (e instanceof Error ? e.message : String(e)) }))
    }
  }
  // OAuth 登出：清 app 内 token + 来源回 cli-login，回拉凭证状态
  async function logoutOAuth() {
    try { await api.logout(engine) } catch { /* 失败也回拉同步 */ }
    setOauthFlow({ code: '' })
    await reloadAuth()
  }

  // codex 授权登录（P7.4）：调 app-server 自管 chatgpt OAuth → 拿 authUrl 开浏览器 → 轮询 completed。
  // 与 claude 粘码流不同：codex 无需用户回填授权码，app-server 自己跑回调，前端只需开浏览器 + 轮询。
  async function startCodexLogin() {
    setCodexLogin({ busy: true })
    try {
      const r = await api.codexLoginStart({ type: 'chatgpt' })
      if (r.done) { setCodexLogin({ done: true }); await reloadAuth(); return }
      // 开浏览器授权，并开始轮询完成态
      if (r.authUrl) window.open(r.authUrl, '_blank', 'noreferrer')
      setCodexLogin({ authUrl: r.authUrl, sessionId: r.loginSessionId, busy: true })
      const sid = r.loginSessionId
      if (!sid) { setCodexLogin({ error: '登录会话创建失败' }); return }
      // 轮询：每 1.5s 查一次，最多 ~5 分钟（app-server 侧也有兜底超时）
      for (let i = 0; i < 200; i++) {
        await new Promise((res) => setTimeout(res, 1500))
        let s
        try { s = await api.codexLoginStatus(sid) } catch { continue }
        if (s.status === 'done') { setCodexLogin({ done: true }); await reloadAuth(); return }
        if (s.status === 'error') { setCodexLogin({ error: s.error || '授权失败', authUrl: r.authUrl }); return }
      }
      setCodexLogin({ error: '授权超时，请重试', authUrl: r.authUrl })
    } catch (e) {
      setCodexLogin({ error: '发起登录失败：' + (e instanceof Error ? e.message : String(e)) })
    }
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
    const payload = { name: edit.name, baseUrl: edit.baseUrl, keyEnv: edit.keyEnv, wireApi: edit.wireApi, models: edit.models, defaultModel: edit.defaultModel || undefined }
    // 解析密钥来源：手动新建 → 先入密钥库取回 id；选了已有 → 直接用其 id
    let apiKeySecretId: string | undefined
    if (edit.secretId === '__new__') {
      if (edit.newKeyName.trim() && edit.newKeyVal.trim()) {
        const { secret } = await api.createSecret({ name: edit.newKeyName.trim(), value: edit.newKeyVal.trim() })
        apiKeySecretId = secret.id
        loadSecrets()
      }
    } else if (edit.secretId) {
      apiKeySecretId = edit.secretId
    }
    if (edit.id === 'new') {
      const { provider } = await api.createProvider({ engine, ...(apiKeySecretId ? { apiKeySecretId } : {}), ...payload })
      await api.setActiveProvider(engine, provider.id)
    } else {
      await api.updateProvider(edit.id, { ...payload, ...(apiKeySecretId ? { apiKeySecretId } : {}) })
    }
    setEdit(null); reload()
  }

  async function remove(id: string) {
    try { await api.deleteProvider(id) } catch { /* 失败也回拉同步 */ }
    if (edit?.id === id) setEdit(null)
    reload()
  }

  // 本机 CLI 登录态块（cli-login 选项选中时，置于官方只读模型区之上）
  // 三态：未登录 notice（无登录按钮，那是本机 CLI 自己的事）/ OAuth 已登录（显 email + 登出）/ API Key 已登录（无 email、无登出）
  const cliLoginBlock = (() => {
    const signedIn = cliLogin?.status === 'signed-in'
    if (!signedIn) {
      // signed-out / unknown（codex）统一走未登录 notice
      return (
        <div className="cli-unlogged">
          <div className="clu-title">本机 {CLI_NAME[engine]} 未登录</div>
          <div className="clu-sub">请在本机用 <code>{engine === 'codex' ? 'codex' : 'claude'}</code> 登录后复用；或改用下面的「授权登录」。</div>
        </div>
      )
    }
    if (cliLogin?.method === 'oauth') {
      return (
        <>
          <div className="acct-row">
            <span className="acct-stat"><span className="acct-dot in" />本机已登录 · {cliLogin?.email || ''}</span>
            <span className="acct-method">OAuth 订阅</span>
            <button className="acct-btn ghost" type="button"
              onClick={() => { if (window.confirm(`登出会登出本机全局 ${CLI_NAME[engine]}（cli-login 复用的就是本机登录态）。`)) { /* 真登出后置，暂不执行 */ } }}>登出</button>
          </div>
          <div className="field-hint" style={{ marginTop: 6 }}>登出会登出本机全局 {CLI_NAME[engine]}（cli-login 复用的就是本机登录态）。</div>
        </>
      )
    }
    // method === 'api_key'：读不到账号、不给登出
    return (
      <>
        <div className="acct-row">
          <span className="acct-stat"><span className="acct-dot in" />本机已登录 · API Key 方式</span>
          <span className="acct-method">本机配置</span>
        </div>
        <div className="field-hint" style={{ marginTop: 6 }}>本机 {CLI_NAME[engine]} 以 API Key 登录，读不到账号信息、也无法在此登出。</div>
      </>
    )
  })()

  // 官方只读模型区（默认 Provider 选中时展示）
  const officialModelsBlock = (
    <div className="prov-models is-readonly">
      <div className="pm-head">模型 · 引擎官方<span className="pm-tag">只读</span></div>
      <div className="model-chips">
        {(CLI_MODELS[engine] ?? []).map((m) => {
          const d = resolveModelDisplay(engine, m.value, { officialLabel: m.label, modelAliases })
          const isEditingAlias = aliasEditing === m.value
          return (
            <button key={m.value} className={`model-chip has-meta${m.value === engineDefault ? ' on' : ''}`} type="button"
              onClick={(e) => {
                // 点铅笔不触发默认选中
                if ((e.target as HTMLElement).closest('.mc-edit')) return
                void api.saveConfig({ engineModels: { [engine]: m.value } as Record<string, string> }).then(() => setEngineDefault(m.value))
              }}>
              <span className="mc-text">
                <span className="mc-name">{d.name}</span>
                {d.showId && <span className="mc-id">{d.id}</span>}
              </span>
              {isEditingAlias
                ? (
                  <span className="pm-alias-edit" onClick={(e) => e.stopPropagation()}>
                    <input
                      className="pm-alias-input"
                      autoFocus
                      placeholder="别名（留空清除）"
                      defaultValue={modelAliases[engine]?.[m.value] ?? ''}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          const alias = (e.target as HTMLInputElement).value.trim()
                          const engineMap = { ...(modelAliases[engine] ?? {}) }
                          if (alias) engineMap[m.value] = alias
                          else delete engineMap[m.value]
                          const updated = { ...modelAliases, [engine]: engineMap } as Record<Engine, Record<string, string>>
                          void api.saveConfig({ modelAliases: updated }).then(() => setModelAliases(updated))
                          setAliasEditing(null)
                        } else if (e.key === 'Escape') {
                          setAliasEditing(null)
                        }
                      }}
                    />
                  </span>
                )
                : (
                  <span className="mc-edit" title="设置别名" onClick={(e) => { e.stopPropagation(); setAliasEditing(m.value) }}>✎</span>
                )
              }
              <span className="mk">✓</span>
            </button>
          )
        })}
      </div>
      <div className="field-hint">默认 Provider 走 CLI 登录态，模型为引擎官方列表、不可增删。点选作为新建会话的默认模型；点 ✎ 设别名。</div>
    </div>
  )

  // 自定义 Provider 模型预览（选中时展示，编辑时不展示）
  const customModelsBlock = (p: ProviderView) => (
    <div className="prov-models">
      <div className="pm-head">模型<span className="pm-count">{p.models.length}</span></div>
      <div className="model-chips">
        {p.models.length === 0
          ? <span className="pm-empty">尚未配置模型，点「编辑」添加</span>
          : p.models.map((m) => {
              const d = resolveModelDisplay(engine, m.value, { providerLabel: m.label })
              return (
                <button key={m.value} className={`model-chip${d.showId ? ' has-meta' : ''}${m.value === p.defaultModel ? ' on' : ''}`} type="button"
                  onClick={() => { void api.updateProvider(p.id, { defaultModel: m.value }).then(reload) }}>
                  {d.showId
                    ? <span className="mc-text"><span className="mc-name">{d.name}</span><span className="mc-id">{d.id}</span></span>
                    : d.name
                  }
                  <span className="mk">✓</span>
                </button>
              )
            })
        }
      </div>
      <div className="field-hint">点选作为该 Provider 新建会话的默认模型；增删改请进「编辑」。</div>
    </div>
  )

  const editor = edit && (
    <div className="model-editor">
      <div className="me-title">{edit.id === 'new' ? '添加 Provider' : '编辑 Provider'}</div>
      <div className="me-row"><label className="me-label">名称</label>
        <input className="field-input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} placeholder="如 我的中转站 / 公司网关" /></div>
      <div className="me-row"><label className="me-label">Base URL</label>
        <input className="field-input" value={edit.baseUrl} onChange={(e) => setEdit({ ...edit, baseUrl: e.target.value })} placeholder="https://api.example.com" /></div>
      <div className="me-row"><label className="me-label">API Key</label>
        <select className="field-input" value={edit.secretId} onChange={(e) => setEdit({ ...edit, secretId: e.target.value })}>
          <option value="">选择密钥…</option>
          {secrets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          <option value="__new__">＋ 手动输入新密钥…</option>
        </select>
        {edit.secretId === '__new__' && (
          <div className="field-row" style={{ marginTop: 6 }}>
            <input className="field-input" value={edit.newKeyName}
              onChange={(e) => setEdit({ ...edit, newKeyName: e.target.value })} placeholder="密钥名称" />
            <input className="field-input" type={showKey ? 'text' : 'password'} value={edit.newKeyVal}
              onChange={(e) => setEdit({ ...edit, newKeyVal: e.target.value })} placeholder="粘贴密钥 / Token" />
            <button className="field-btn" type="button" onClick={() => setShowKey((v) => !v)}>{showKey ? '隐藏' : '显示'}</button>
          </div>
        )}
        <span className="field-hint">从密钥管理选择已有密钥；选「手动输入新密钥」则保存 Provider 时新建一条并存入密钥管理。</span></div>
      {engine === 'claude' ? (
        <div className="me-row"><label className="me-label">凭证类型</label>
          <div className="seg-control">
            <button className={edit.keyEnv === 'api_key' ? 'on' : ''} type="button" onClick={() => setEdit({ ...edit, keyEnv: 'api_key' })}>API Key</button>
            <button className={edit.keyEnv === 'auth_token' ? 'on' : ''} type="button" onClick={() => setEdit({ ...edit, keyEnv: 'auth_token' })}>Auth Token</button>
          </div>
          <span className="field-hint">官方 / 兼容 x-api-key 选 API Key；多数第三方中转选 Auth Token。</span></div>
      ) : (
        <details className="me-row"><summary className="me-adv-toggle">高级</summary>
          <label className="me-label">wire_api（协议）</label>
          <div className="seg-control">
            <button className={edit.wireApi === 'chat' ? 'on' : ''} type="button" onClick={() => setEdit({ ...edit, wireApi: 'chat' })}>chat</button>
            <button className={edit.wireApi === 'responses' ? 'on' : ''} type="button" onClick={() => setEdit({ ...edit, wireApi: 'responses' })}>responses</button>
          </div>
          <span className="field-hint">默认 responses；OpenAI 兼容 chat completions 上游选 chat。注入通路随 app-server 主体落地。</span>
        </details>
      )}
      <div className="me-row"><label className="me-label">支持的模型<span className="me-hint-inline">点选设为默认 · ✕ 删除</span></label>
        <div className="model-chips em-chips">
          {edit.models.map((m) => {
            const d = resolveModelDisplay(engine, m.value, { providerLabel: m.label })
            return (
              <span key={m.value} className={`em-chip${d.showId ? ' has-id' : ''}${m.value === edit.defaultModel ? ' on' : ''}`}
                onClick={() => setEdit({ ...edit, ...editModelsReducer(edit, { type: 'setDefault', value: m.value }) })}>
                <span className="em-name">
                  {d.name}
                  {d.showId && <span className="em-id">{d.id}</span>}
                </span>
                <button className="em-x" type="button" title="删除"
                  onClick={(e) => { e.stopPropagation(); setEdit({ ...edit, ...editModelsReducer(edit, { type: 'del', value: m.value }) }) }}>✕</button>
              </span>
            )
          })}
          {adding
            ? (
              <span className="em-chip is-adding em-adding-2col">
                <input className="em-input" autoFocus placeholder="模型 ID"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const idVal = (e.target as HTMLInputElement).value
                      const aliasInput = (e.target as HTMLInputElement).nextElementSibling as HTMLInputElement | null
                      setEdit({ ...edit, ...editModelsReducer(edit, { type: 'add', value: idVal, label: aliasInput?.value }) })
                      setAdding(false); setAddingAlias('')
                    }
                  }} />
                <input className="em-input em-alias-input" placeholder="别名（可选）"
                  value={addingAlias}
                  onChange={(e) => setAddingAlias(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const aliasInput = e.target as HTMLInputElement
                      const idInput = aliasInput.previousElementSibling as HTMLInputElement | null
                      setEdit({ ...edit, ...editModelsReducer(edit, { type: 'add', value: idInput?.value ?? '', label: aliasInput.value }) })
                      setAdding(false); setAddingAlias('')
                    }
                  }} />
                <button className="em-x em-ok" type="button" title="添加"
                  onClick={() => {
                    const chip = document.activeElement?.closest('.em-adding-2col') as HTMLElement | null
                    const inputs = chip?.querySelectorAll<HTMLInputElement>('.em-input')
                    const idVal = inputs?.[0]?.value ?? ''
                    const aliasVal = inputs?.[1]?.value ?? ''
                    setEdit({ ...edit, ...editModelsReducer(edit, { type: 'add', value: idVal, label: aliasVal }) })
                    setAdding(false); setAddingAlias('')
                  }}>✓</button>
              </span>
            )
            : <button className="em-chip is-add" type="button" onClick={() => { setAdding(true); setAddingAlias('') }}>＋ 添加模型</button>}
        </div></div>
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

  // 每来源代理绑定下拉（source = 官方选项 id / 自定义 providerId）。cli-login 不调用本函数。
  const proxyBindRow = (source: string) => (
    <div className="prov-proxy-bind">
      <span className="ppb-label">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><path d="M3 12h18" /><path d="M12 3a15.3 15.3 0 0 1 4 9 15.3 15.3 0 0 1-4 9 15.3 15.3 0 0 1-4-9 15.3 15.3 0 0 1 4-9z" /></svg>
        代理
      </span>
      <select value={proxyBindings[source] ?? ''} onChange={(e) => bindProxy(source, e.target.value)}>
        <option value="">直连</option>
        {proxies.map((px) => <option key={px.id} value={px.id}>{px.name}</option>)}
      </select>
    </div>
  )

  const item = (id: string, name: string, sub: string, actions?: React.ReactNode, extra?: React.ReactNode) => (
    <div className="prov-block" key={id}>
      <div className="prov-row">
        <button className={`prov-item${activeSource === id ? ' on' : ''}`} type="button" onClick={() => pick(id)}>
          <span className="prov-radio" /><span className="prov-meta"><span className="prov-name">{name}</span><span className="prov-sub">{sub}</span></span>
        </button>
        {actions}
      </div>
      {extra}
      {panel(id)}
    </div>
  )

  // 官方组三选项配置（id 取自 contract AUTH_SOURCE_OFFICIAL 顺序）
  const officialOpts: { id: string; name: string; badge?: string; sub: string }[] = [
    { id: 'cli-login', name: '使用本机 CLI 登录状态', badge: '默认', sub: `复用本机自带 ${CLI_NAME[engine]} 的登录，只读复用、不改全局配置` },
    { id: 'oauth', name: '授权登录', sub: '在 agent-shell 内 OAuth 登录（仅本应用内生效，不动全局 CLI）' },
    { id: 'official-key', name: '官网 API Key', sub: `填 ${OFFICIAL_BRAND[engine]} 官方 key（仅本应用内生效）` },
  ]
  // codex：授权登录(oauth) 走 app-server 自管 chatgpt 流程（P7.4 已接入，启用）；
  // 官网 API Key 的 codex 注入语义（覆盖 model_provider）未在 P7 验证 → 暂仍禁用，待后续展开。
  const officialDisabled = (id: string) => engine === 'codex' && id === 'official-key'

  // 官方选项选中时展开的额外内容
  const officialExtra = (id: string): React.ReactNode => {
    if (id === 'cli-login') {
      // 本机登录态详情（三态）置于官方只读模型区之上
      return <div className="prov-official-extra" data-eng={engine}>{cliLoginBlock}{officialModelsBlock}</div>
    }
    if (id === 'oauth') {
      // codex：授权登录走 app-server 自管 chatgpt OAuth（P7.4）——一键开浏览器授权 + 轮询完成，无需回填授权码。
      // 已登录态以本机 cli-login 检测为准（chatgpt 登录写本机 ~/.codex，cliLogin 会反映 oauth+email）。
      if (engine === 'codex') {
        const codexSignedIn = cliLogin?.status === 'signed-in' && cliLogin?.method === 'oauth'
        return (
          <div className="prov-official-extra" data-eng={engine}>
            {codexSignedIn
              ? (
                <div className="acct-row">
                  <span className="acct-stat"><span className="acct-dot in" />已用 ChatGPT 授权登录{cliLogin?.email ? ' · ' + cliLogin.email : ''}</span>
                  <span className="acct-method">OpenAI · 本机 codex</span>
                </div>
              )
              : (
                <div className="acct-auth-steps">
                  <div className="acct-auth-title">用 ChatGPT 账号授权 Codex：</div>
                  <div className="acct-step">
                    <span className="acct-step-n">1</span>
                    <div className="acct-step-body">
                      <div className="acct-step-t">点击下方按钮，浏览器将打开 OpenAI 授权页</div>
                      <button className="acct-btn primary acct-step-btn" type="button" disabled={codexLogin.busy} onClick={startCodexLogin}>
                        {codexLogin.busy ? '等待浏览器授权…' : '用 ChatGPT 授权登录'}
                      </button>
                      {codexLogin.authUrl && (
                        <div className="acct-url">
                          <code className="acct-url-code">{codexLogin.authUrl}</code>
                          <button className="acct-btn ghost acct-url-open" type="button" onClick={() => window.open(codexLogin.authUrl, '_blank', 'noreferrer')}>重新打开授权页</button>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="acct-step">
                    <span className="acct-step-n">2</span>
                    <div className="acct-step-body">
                      <div className="acct-step-t">在浏览器完成授权后自动登录</div>
                      <div className="acct-step-d">授权由 Codex（app-server）自管，完成后本页会自动更新，无需回填授权码。</div>
                      {codexLogin.error && <div className="acct-err">{codexLogin.error}</div>}
                    </div>
                  </div>
                </div>
              )}
            <div className="field-hint" style={{ marginTop: 6 }}>授权登录写入本机 codex（~/.codex），与「使用本机 CLI 登录状态」共享同一登录态。</div>
            {officialModelsBlock}
          </div>
        )
      }
      // claude：app 内 OAuth 3 步粘码流。
      // 已登录态以服务端 oauthSignedIn 为准（来自 /auth/status，跨重开/切引擎保留）→ 显示已登录行 + 登出；否则展示 3 步流程
      if (oauthSignedIn) {
        return (
          <div className="prov-official-extra" data-eng={engine}>
            <div className="acct-row">
              <span className="acct-stat"><span className="acct-dot in" />已授权登录{oauthEmail ? ' · ' + oauthEmail : ''}</span>
              <span className="acct-method">OAuth · 仅本应用</span>
              <button className="acct-btn ghost" type="button" onClick={logoutOAuth}>登出</button>
            </div>
            <div className="field-hint" style={{ marginTop: 6 }}>登出仅清除本应用内的 OAuth 登录，不影响本机全局 {CLI_NAME[engine]}。</div>
            {officialModelsBlock}
          </div>
        )
      }
      return (
        <div className="prov-official-extra" data-eng={engine}>
          <div className="acct-auth-steps">
            <div className="acct-auth-title">按以下步骤授权您的 Claude 账号：</div>
            <div className="acct-step">
              <span className="acct-step-n">1</span>
              <div className="acct-step-body">
                <div className="acct-step-t">点击下方按钮生成授权 URL</div>
                <button className="acct-btn primary acct-step-btn" type="button" disabled={oauthFlow.busy} onClick={genOAuthUrl}>生成授权 URL</button>
                {oauthFlow.authorizeUrl && (
                  <div className="acct-url">
                    <code className="acct-url-code">{oauthFlow.authorizeUrl}</code>
                    <button className="acct-btn ghost acct-url-open" type="button" onClick={() => window.open(oauthFlow.authorizeUrl, '_blank', 'noreferrer')}>在浏览器打开</button>
                  </div>
                )}
              </div>
            </div>
            <div className="acct-step">
              <span className="acct-step-n">2</span>
              <div className="acct-step-body">
                <div className="acct-step-t">在浏览器中打开授权 URL 并完成授权</div>
                <div className="acct-step-d">在新标签页打开授权 URL，登录您的 Claude 账号并授权。</div>
              </div>
            </div>
            <div className="acct-step">
              <span className="acct-step-n">3</span>
              <div className="acct-step-body">
                <div className="acct-step-t">输入授权码</div>
                <div className="acct-step-d">授权完成后，页面会显示一个授权码。复制并粘贴到下方：</div>
                <label className="acct-field-label">🔑 授权码</label>
                <textarea className="acct-code-ta" rows={2} placeholder="粘贴 Claude 页面的授权码…"
                  value={oauthFlow.code} onChange={(e) => setOauthFlow((f) => ({ ...f, code: e.target.value }))} />
                <div className="acct-fieldhint">ⓘ 粘贴从 Claude 页面复制的授权码</div>
                {oauthFlow.error && <div className="acct-err">{oauthFlow.error}</div>}
                <div className="acct-step-actions">
                  <button className="acct-btn primary" type="button" disabled={oauthFlow.busy || !oauthFlow.state || !oauthFlow.code.trim()} onClick={confirmOAuth}>确认登录</button>
                  <button className="acct-btn ghost" type="button" onClick={() => setOauthFlow({ code: '' })}>取消</button>
                </div>
              </div>
            </div>
          </div>
          {officialModelsBlock}
        </div>
      )
    }
    // official-key：复用密钥选择器（选已有 / ＋手动新建）→ 保存调 setOfficialKey
    return (
      <div className="prov-official-extra" data-eng={engine}>
        <div className="acct-keyrow" style={{ flexWrap: 'wrap', gap: 8 }}>
          <select className="acct-key" value={officialKeyDraft} onChange={(e) => setOfficialKeyDraft(e.target.value)}>
            <option value="">选择 {OFFICIAL_BRAND[engine]} 官方 API Key…</option>
            {secrets.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            <option value="__new__">＋ 手动输入新密钥…</option>
          </select>
          <button className="acct-btn primary" type="button" onClick={saveOfficialKey}>保存</button>
          {officialKeyDraft === '__new__' && (
            <div style={{ flexBasis: '100%', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <input className="field-input" value={officialNewName}
                onChange={(e) => setOfficialNewName(e.target.value)} placeholder={`密钥名称（如 ${OFFICIAL_BRAND[engine]} 官方 Key）`} />
              <input className="field-input" type="password" value={officialNewVal}
                onChange={(e) => setOfficialNewVal(e.target.value)} placeholder="粘贴官方 API Key（sk-…），保存后存入密钥管理" />
            </div>
          )}
        </div>
        <div className="field-hint" style={{ marginTop: 6 }}>从密钥管理选择已有密钥；选「手动输入新密钥」则保存时新建一条并存入密钥管理。</div>
        {officialModelsBlock}
      </div>
    )
  }

  // 官方选项行（点击切来源；codex 的 oauth/official-key 禁用）
  const officialItem = (o: { id: string; name: string; badge?: string; sub: string }) => {
    const on = activeSource === o.id
    const disabled = officialDisabled(o.id)
    return (
      <div className="prov-block" key={o.id}>
        <div className="prov-row">
          <button className={`prov-item${on ? ' on' : ''}`} type="button" disabled={disabled}
            title={disabled ? 'codex 登录随 app-server 集成上线' : undefined}
            style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
            onClick={() => { if (!disabled) pickSource(o.id) }}>
            <span className="prov-radio" />
            <span className="prov-meta">
              <span className="prov-name">{o.name}{o.badge && <span className="prov-badge">{o.badge}</span>}</span>
              <span className="prov-sub">{o.sub}</span>
            </span>
          </button>
          {/* cli-login 永不走代理（复用本机 CLI）；oauth/official-key 可绑代理。codex 该两项禁用时也不显示 */}
          {o.id !== 'cli-login' && !disabled && proxyBindRow(o.id)}
        </div>
        {o.id !== 'cli-login' && !disabled && <div className="prov-proxy-hint">该来源的 OAuth / 请求走此代理；直连=不走</div>}
        {on && !disabled ? officialExtra(o.id) : null}
      </div>
    )
  }

  return (
    <div className="set-card" style={{ marginTop: 14 }}>
      <div className="model-head">上游 Provider：<b>{AGENT_LABEL[engine]}</b></div>
      <div className="field-hint" style={{ margin: '-4px 0 12px' }}>选择该引擎走哪个上游。「默认」走 CLI 自己的登录态；自定义则把上游地址 + 密钥注入本机 CLI 进程——不改写你的全局配置。</div>
      <div className="prov-list">
        <div className="prov-group">
          <div className="prov-group-label">官方 · {OFFICIAL_BRAND[engine]}</div>
          {officialOpts.map((o) => officialItem(o))}
        </div>
        <div className="prov-group">
          <div className="prov-group-label">自定义（第三方上游）</div>
          {list.map((p) => item(
            p.id,
            p.name,
            `${p.baseUrl} · ${engine === 'codex' ? `wire_api: ${p.wireApi}` : (p.keyEnv === 'auth_token' ? 'Auth Token' : 'API Key')}`,
            <div className="prov-actions">
              {proxyBindRow(p.id)}
              <button className="prov-act" type="button" onClick={() => runTest(p.id)}>测试</button>
              <button className="prov-act" type="button" onClick={() => openEdit(p)}>编辑</button>
              <button className="prov-act danger" type="button" onClick={() => remove(p.id)}>删除</button>
            </div>,
            edit?.id === p.id ? editor : (activeSource === p.id ? customModelsBlock(p) : null)
          ))}
          {edit?.id === 'new' ? editor : <button className="prov-add" type="button" onClick={() => openEdit()}>＋ 添加 Provider</button>}
        </div>
      </div>
    </div>
  )
}
