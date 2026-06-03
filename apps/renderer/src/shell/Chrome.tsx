// Chrome 顶栏 — 持久多页签条（对齐 open-design WorkspaceTabsBar 的精简版）
// DOM 结构沿用原型 app.js renderChrome：.chrome > .chrome-tabs(.ctab*) + .chrome-newtab + .chrome-right
// 页签来自持久状态（见 workspaceTabs.ts）：home(首页) singleton + 任意项目页签；× 才关、点切换。
// 项目页签标题/引擎色按 projectId 现查 live projects —— 改名自动同步，无快照。
import type { ProjectDTO } from '../api/types'
import type { ChromeTab } from './workspaceTabs'

interface ChromeProps {
  tabs: ChromeTab[]
  activeTabId: string
  projects: ProjectDTO[]
  onSelectTab: (tab: ChromeTab) => void
  onCloseTab: (id: string) => void
  onNewTab: () => void   // chrome「+」：新建/聚焦首页页签（对齐 open-design，非新建项目）
}

export function Chrome({ tabs, activeTabId, projects, onSelectTab, onCloseTab, onNewTab }: ChromeProps) {
  // 防御性默认：页签条是纯展示组件，数据缺失时也应安全渲染（不让一帧的空数据把整树拖崩）
  const byId = new Map((projects ?? []).map((p) => [p.id, p]))
  const tabList = tabs ?? []
  return (
    <div className="chrome" id="chrome">
      <div className="chrome-tabs">
        {tabList.map((tab) => {
          const active = tab.id === activeTabId
          const project = tab.kind === 'project' ? byId.get(tab.projectId) : undefined
          const name = tab.kind === 'home' ? '首页' : (project?.name || '未命名项目')
          const engine = project?.engine ?? 'claude'
          return (
            <a
              key={tab.id}
              className={`ctab${active ? ' is-active' : ''}`}
              onClick={(e) => { e.preventDefault(); onSelectTab(tab) }}
            >
              <span className="name">
                {tab.kind === 'project' && <span className="dot" style={{ background: `var(--${engine})` }} />}
                {name}
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
      <div className="chrome-right" />
    </div>
  )
}
