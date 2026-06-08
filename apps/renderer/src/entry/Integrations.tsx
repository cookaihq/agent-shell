import { useState } from 'react'
import { SkillsSettings } from '../settings/SkillsSettings'
import { CliTools } from '../settings/CliTools'

type IntegTab = 'skills' | 'mcp' | 'cli' | 'connectors' | 'bridge' | 'sync'
const TABS: { k: IntegTab; t: string; h: string }[] = [
  { k: 'skills', t: '技能', h: '源 · 技能库' },
  { k: 'mcp', t: 'MCP', h: '外部工具' },
  { k: 'cli', t: '命令行工具', h: 'CLI · 市场' },
  { k: 'connectors', t: '连接器', h: '账号与 API' },
  { k: 'bridge', t: '远程桥接', h: 'Telegram · 飞书 · …' },
  { k: 'sync', t: '数据同步', h: '备份 · Git' },
]
// 真实功能 tab（无「即将上线」徽标）：技能、命令行工具
const REAL_TABS: IntegTab[] = ['skills', 'cli']
type SoonTab = Exclude<IntegTab, 'skills' | 'cli'>
const SOON: Record<SoonTab, { title: string; desc: string }> = {
  mcp: { title: 'MCP 服务器', desc: '把外部 MCP 工具接入 agent 循环（转发给 Claude Code）——MCP 服务器管理即将上线。' },
  connectors: { title: '连接器', desc: '连接 GitHub / Linear / Slack 等账号与 API，供 agent 在会话中读写——连接器即将上线。' },
  bridge: { title: '远程桥接', desc: '通过 Telegram、飞书、Discord 等外部渠道远程向 agent 派任务——远程桥接即将上线。' },
  sync: { title: '数据同步', desc: '把技能库、Memory、CLAUDE.md 等本地资产备份到 Git、多设备保持一致——数据同步即将上线。' },
}

const SparkIcon = () => (
  <svg width="22" height="22" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d="M12 2l1.6 5.4L19 9l-5.4 1.6L12 16l-1.6-5.4L5 9l5.4-1.6z" /></svg>
)

function SoonCard({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="integ-soon-card">
      <span className="integ-soon-ic"><SparkIcon /></span>
      <div>
        <div className="integ-soon-kicker">即将上线</div>
        <h3 className="integ-soon-title">{title}</h3>
        <p className="integ-soon-desc">{desc}</p>
      </div>
    </div>
  )
}

interface IntegrationsProps {
  // onInstallSeed：CLI 工具页点「安装」时预填首页 composer（透传给 CliTools）
  onInstallSeed?: (text: string) => void
}

export function Integrations({ onInstallSeed }: IntegrationsProps) {
  const [tab, setTab] = useState<IntegTab>('skills')
  return (
    <>
      <div>
        <span className="integ-kicker">集成</span>
        <h1 className="auto-title" style={{ fontSize: 30 }}>集成</h1>
        <p className="auto-sub">接入外部系统，把 MCP 工具带进 agent 循环，并在其它 IDE、脚本与自动化里使用 Agent Shell。</p>
      </div>
      <div className="integ-tabs">
        {TABS.map((t) => (
          <button key={t.k} type="button" className={`integ-tab${tab === t.k ? ' is-active' : ''}`} onClick={() => setTab(t.k)}>
            <div className="it">{t.t}{!REAL_TABS.includes(t.k) && <span className="integ-tab-soon">即将上线</span>}</div>
            <div className="ih">{t.h}</div>
          </button>
        ))}
      </div>
      {tab === 'skills' ? <SkillsSettings /> : tab === 'cli' ? <CliTools onInstallSeed={onInstallSeed} /> : <SoonCard {...SOON[tab as SoonTab]} />}
    </>
  )
}
