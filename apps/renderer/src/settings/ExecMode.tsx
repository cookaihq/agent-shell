import { useEffect, useState } from 'react'
import { api } from '../api/client'
import type { EngineDetail } from '../api/types'
import { ProviderSection } from './ProviderSection'
import { isTestedCodexVersion } from './codexCompat'

// 每个引擎的测试结果状态
type TestResult = { ok: boolean; message?: string } | null

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

  useEffect(() => {
    loadEngines()
  }, [])

  // 选中引擎
  const selectedEngine = engines.find(e => e.name === selectedName) ?? null

  // 切换选中引擎
  function handleSelectEngine(engine: EngineDetail) {
    if (engine.bin == null) return
    setSelectedName(engine.name)
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

  return (
    <>
      <p className="set-kicker">设置</p>
      <h2 className="set-h">执行模式</h2>
      <p className="set-sub">选择用来运行提示词的引擎（随 Agent Shell 自带、开箱即用），并为每个上游 Provider 配置模型。</p>
      <div id="execCli">
        <div className="cli-head">
          <span className="cli-head-t">自带引擎（{engines.length}）</span>
          <span className="cli-head-note">随 Agent Shell 打包，无需本机安装</span>
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
                    {/* codex 协议版本兼容徽标：app-server 协议实验性，仅对「测过的确切版本」标已适配。
                        非硬阻断——未测试版本仍可用，只是给提示。仅 codex 显示（claude 有自己的版本体系）。 */}
                    {engine.name === 'codex' && engine.version != null && (
                      isTestedCodexVersion(engine.version) ? (
                        <span
                          style={{ marginLeft: 6, fontSize: '0.85em', color: 'var(--ok, #2ea043)' }}
                          title="该 codex 版本已通过 app-server 协议适配测试"
                        >
                          ✓ 已适配
                        </span>
                      ) : (
                        <span
                          style={{ marginLeft: 6, fontSize: '0.85em', color: 'var(--warn, #d29922)' }}
                          title="agent-shell 仅对特定 codex 版本测试过 app-server 协议，当前版本未在测试范围内，可能不稳定"
                        >
                          ⚠️ 未测试版本，可能不稳定
                        </span>
                      )
                    )}
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
        {selectedEngine && <ProviderSection engine={selectedEngine.name} />}
      </div>
    </>
  )
}
