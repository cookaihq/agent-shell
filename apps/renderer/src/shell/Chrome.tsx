// Chrome 顶栏 — 持久多页签条（对齐 open-design WorkspaceTabsBar 的精简版）
// DOM 结构沿用原型 app.js renderChrome：.chrome > .chrome-tabs(.ctab*) + .chrome-newtab + .chrome-right
// 页签来自持久状态（见 workspaceTabs.ts）：四个 entry 单例页签（首页/项目/任务自动化/集成）+ 任意项目页签；× 才关、点切换。
// 项目页签标题/引擎色按 projectId 现查 live projects —— 改名自动同步，无快照。
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import type { UpdateState } from '@agent-shell/contracts'
import type { ProjectDTO } from '../api/types'
import type { ChromeTab, EntryKind } from './workspaceTabs'
import { useTabUnread, statusDotClass } from './tabUnread'
import { UpdateIndicator } from './UpdateIndicator'

// entry 单例页签的中文标题（V1 只渲染中文名、不加图标，与 home 页签一致）。
const ENTRY_NAME: Record<EntryKind, string> = {
  home: '首页',
  projects: '项目',
  automations: '任务自动化',
  integrations: '集成',
}

interface ChromeProps {
  tabs: ChromeTab[]
  activeTabId: string
  projects: ProjectDTO[]
  onSelectTab: (tab: ChromeTab) => void
  onCloseTab: (id: string) => void
  onNewTab: () => void   // chrome「+」：新建/聚焦首页页签（对齐 open-design，非新建项目）
  update?: UpdateState | null   // 有可用更新时右上角常驻图标；不传即不显示（默认 null）
  // chrome-right 插槽：AppNav 注入通知中心铃铛（NotificationCenter）等需要 Provider 上下文的部件。
  // Chrome 保持纯展示/解耦——不直接依赖通知 store，铃铛由持有 store 与跳会话回调的 AppNav 塞进来。
  chromeRight?: ReactNode
}

export function Chrome({ tabs, activeTabId, projects, onSelectTab, onCloseTab, onNewTab, update, chromeRight }: ChromeProps) {
  // 防御性默认：页签条是纯展示组件，数据缺失时也应安全渲染（不让一帧的空数据把整树拖崩）
  const tabList = tabs ?? []
  const byId = useMemo(() => new Map((projects ?? []).map((p) => [p.id, p])), [projects])
  // 项目 tab 未读跟踪（Issue 11）：圆点表状态、引擎挪左侧彩条；entry 单例 tab 不参与。
  const projectItems = useMemo(
    () => tabList.filter((t): t is Extract<ChromeTab, { kind: 'project' }> => t.kind === 'project')
      .map((t) => ({ id: t.projectId, status: byId.get(t.projectId)?.status ?? 'idle' })),
    [tabList, byId],
  )
  const activeTab = tabList.find((t) => t.id === activeTabId)
  const activeProjectId = activeTab?.kind === 'project' ? activeTab.projectId : null
  const { isUnread } = useTabUnread('project', projectItems, activeProjectId)
  return (
    <div className="chrome" id="chrome">
      <div className="chrome-tabs">
        {tabList.map((tab) => {
          const active = tab.id === activeTabId
          const project = tab.kind === 'project' ? byId.get(tab.projectId) : undefined
          // entry 单例页签取中文名；project 页签取 live 项目名
          const name = tab.kind === 'project' ? (project?.name || '未命名项目') : ENTRY_NAME[tab.kind]
          const engine = project?.engine ?? 'claude'
          // 项目 tab 才有引擎左条 + 状态圆点（Issue 11）；entry 单例 tab 无
          const projectId = tab.kind === 'project' ? tab.projectId : null
          const status = project?.status ?? 'idle'
          const running = projectId !== null && status === 'running'
          const showDot = projectId !== null && (running || status === 'failed' || isUnread(projectId, status))
          return (
            <a
              key={tab.id}
              className={`ctab${active ? ' is-active' : ''}${projectId !== null ? ` ${engine}` : ''}`}
              onClick={(e) => { e.preventDefault(); onSelectTab(tab) }}
            >
              <span className="name">
                {showDot && <span className={`dot ${statusDotClass(status, running)}`} />}
                <span className="ctab-label">{name}</span>
              </span>
              <span
                className="x"
                onClick={(e) => { e.preventDefault(); e.stopPropagation(); onCloseTab(tab.id) }}
              >×</span>
            </a>
          )
        })}
      </div>
      {/* chrome-newtab 文本 "+"：新建/聚焦首页页签（对齐 open-design createNewTab，从首页再发起新项目） */}
      <button className="chrome-newtab" title="新建标签页" onClick={onNewTab}>+</button>
      <div className="chrome-right">{chromeRight}<UpdateIndicator update={update ?? null} /></div>
    </div>
  )
}
