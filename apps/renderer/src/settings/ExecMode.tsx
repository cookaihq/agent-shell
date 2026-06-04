import { useEffect, useState } from 'react'
import type { AgentShellBridge } from '@agent-shell/contracts'
import { api } from '../api/client'
import type { EngineDetail } from '../api/types'
import { CLI_MODELS } from '../workspace/runtimeState'

// 每个引擎的测试结果状态
type TestResult = { ok: boolean; message?: string } | null

// 引擎更新信息（latestVersion 查不到为 null → 不提示）
type UpdateInfo = { latestVersion: string | null; updateUrl: string }

/** 比较 x.y.z 版本号：latest 是否比 current 新。任一为空 / 非法 → false（不提示更新）。 */
function isNewer(latest: string | null, current: string | null): boolean {
  if (!latest || !current) return false
  const pa = latest.split('.').map(Number), pb = current.split('.').map(Number)
  if (pa.some(isNaN) || pb.some(isNaN)) return false
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const a = pa[i] ?? 0, b = pb[i] ?? 0
    if (a !== b) return a > b
  }
  return false
}

// CLI 图标 SVG（1:1 from prototype settings.html L60/65）
function ClaudeIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--accent)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M8 9l4 4-4 4"/>
      <path d="M14 17h4"/>
    </svg>
  )
}

function CodexIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--blue)" strokeWidth="2.2">
      <circle cx="12" cy="12" r="8"/>
      <path d="M12 8v8M8 12h8" strokeLinecap="round"/>
    </svg>
  )
}

// cli-meta 文案（1:1 from prototype）
const CLI_META: Record<string, string> = {
  claude: '· Anthropic 官方 CLI',
  codex: '· OpenAI 官方 CLI',
}

export function ExecMode() {
  const [engines, setEngines] = useState<EngineDetail[]>([])
  const [selectedName, setSelectedName] = useState<string | null>(null)
  // 每引擎测试结果（测试按钮文案/状态）：null=未测试, loading=测试中
  const [testResults, setTestResults] = useState<Record<string, TestResult | 'loading'>>({})
  // 每个引擎的当前 chip 选中索引
  const [chipIndex, setChipIndex] = useState<Record<string, number>>({})
  // 每引擎更新信息（进页面异步查 npm 最新版；查不到/网络错则该引擎无条目，不提示）
  const [updates, setUpdates] = useState<Record<string, UpdateInfo>>({})

  async function loadEngines() {
    try {
      const { engines: list } = await api.enginesDetail()
      setEngines(list)
      // 默认选中首个 bin != null 的引擎
      const first = list.find(e => e.bin != null)
      if (first) {
        setSelectedName(prev => prev ?? first.name)
      }
    } catch {
      // 保留旧态，不崩溃
    }
  }

  // 进页面异步查各引擎最新版（独立于本地探测，不阻塞首屏）；失败静默保留旧态
  async function loadUpdates() {
    try {
      const { updates: list } = await api.enginesUpdates()
      setUpdates(Object.fromEntries(list.map(u => [u.name, { latestVersion: u.latestVersion, updateUrl: u.updateUrl }])))
    } catch {
      // 网络错/接口失败 → 不提示更新
    }
  }

  useEffect(() => {
    loadEngines()
    loadUpdates()
  }, [])

  // 点更新徽标：在系统浏览器打开官方 GitHub releases 页（桌面壳走 openExternal 桥，dev/浏览器回落 window.open）
  async function handleOpenUpdate(e: React.MouseEvent, url: string) {
    e.stopPropagation()
    const bridge = (window as unknown as { agentShell?: AgentShellBridge }).agentShell
    if (bridge?.openExternal) await bridge.openExternal(url)
    else window.open(url, '_blank', 'noopener')
  }

  // 选中引擎
  const selectedEngine = engines.find(e => e.name === selectedName) ?? null

  // 切换选中引擎时重置 chip 到第 0 个
  function handleSelectEngine(engine: EngineDetail) {
    if (engine.bin == null) return
    setSelectedName(engine.name)
    setChipIndex(prev => ({ ...prev, [engine.name]: 0 }))
  }

  // 测试引擎
  async function handleTest(engine: EngineDetail) {
    setTestResults(prev => ({ ...prev, [engine.name]: 'loading' }))
    try {
      const res = await api.testEngine(engine.name)
      setTestResults(prev => ({ ...prev, [engine.name]: { ok: res.ok, message: res.message } }))
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : '连接失败'
      setTestResults(prev => ({ ...prev, [engine.name]: { ok: false, message: msg } }))
    }
  }

  // 重新扫描：重新拉取引擎列表，清除测试结果
  function handleRescan() {
    setTestResults({})
    loadEngines()
    loadUpdates()
  }

  // 检测到的引擎数量（bin != null）
  const detectedCount = engines.filter(e => e.bin != null).length

  // 当前选中引擎的内置模型 chips
  const modelOptions = selectedEngine
    ? ['Default (CLI config)', ...(CLI_MODELS[selectedEngine.name] ?? []).map((m) => m.label)]
    : []
  const currentChipIdx = selectedEngine ? (chipIndex[selectedEngine.name] ?? 0) : 0

  function handleChipClick(engineName: string, idx: number) {
    setChipIndex(prev => ({ ...prev, [engineName]: idx }))
  }

  return (
    <>
      <p className="set-kicker">设置</p>
      <h2 className="set-h">执行模式</h2>
      <p className="set-sub">选择用来运行提示词的本机 CLI。</p>
      <div id="execCli">
        <div className="cli-head">
          <span className="cli-head-t">你的 CLI（{detectedCount}）</span>
          <button className="rescan" onClick={handleRescan}>↻ 重新扫描</button>
        </div>
        <div className="cli-list">
          {engines.map(engine => {
            const isSel = engine.name === selectedName
            const testResult = testResults[engine.name]
            return (
              <div
                key={engine.name}
                className={`cli-card${isSel ? ' sel' : ''}`}
                onClick={() => handleSelectEngine(engine)}
                style={engine.bin == null ? { cursor: 'default', opacity: 0.6 } : { cursor: 'pointer' }}
              >
                <span className={`cli-ic ${engine.name}`}>
                  {engine.name === 'claude' ? <ClaudeIcon /> : <CodexIcon />}
                </span>
                <div className="cli-info">
                  <div className="cli-name">
                    {engine.label}
                    <span className="cli-meta">{CLI_META[engine.name] ?? ''}</span>
                  </div>
                  <div className="cli-ver">
                    {engine.version != null ? engine.version : '未检测到版本'}
                    {(() => {
                      const up = updates[engine.name]
                      if (!up || !isNewer(up.latestVersion, engine.version)) return null
                      return (
                        <button
                          className="cli-update"
                          title={`点击查看 ${up.latestVersion} 更新（官方 GitHub）`}
                          onClick={e => handleOpenUpdate(e, up.updateUrl)}
                        >
                          ↑ 有新版本 {up.latestVersion}
                        </button>
                      )
                    })()}
                    {testResult && testResult !== 'loading' && (
                      <span style={{ marginLeft: 6, fontSize: '0.85em' }}>
                        {testResult.ok ? '✓' : `✗${testResult.message ? ' ' + testResult.message : ''}`}
                      </span>
                    )}
                    {testResult === 'loading' && (
                      <span style={{ marginLeft: 6, fontSize: '0.85em' }}>测试中…</span>
                    )}
                  </div>
                </div>
                {engine.bin != null && (
                  <button
                    className="cli-test"
                    onClick={e => { e.stopPropagation(); handleTest(engine) }}
                  >
                    测试
                  </button>
                )}
              </div>
            )
          })}
        </div>
        {selectedEngine && (
          <div className="set-card" style={{ marginTop: 14 }}>
            <div className="model-head">模型：<b>{selectedEngine.label}</b></div>
            <div className="field">
              <div className="field-label">模型 · 内置列表</div>
              <div className="model-chips">
                {modelOptions.map((opt, idx) => (
                  <button
                    key={opt}
                    className={`model-chip${idx === currentChipIdx ? ' on' : ''}`}
                    onClick={() => handleChipClick(selectedEngine.name, idx)}
                  >
                    {opt}<span className="mk">✓</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="field-hint">正在显示内置默认值。点击“重新扫描”可从 CLI 拉取实时模型。</div>
          </div>
        )}
      </div>
    </>
  )
}
