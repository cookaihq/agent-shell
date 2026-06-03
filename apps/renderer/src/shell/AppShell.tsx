// AppShell — 外框骨架，对照原型 workspace.html 顶层结构
// .shell > .chrome(由 chrome prop 传入) + .body > .app(children)
//
// 决策（Task 9 备注）：
//   - useSplitDrag 留给 Workspace (Task 14) 使用，AppShell 不管 split
//   - AppShell 只渲染 .shell > {chrome} + .body > {children}
//   - children = .app 内容（ProjBar + .split 由 Workspace 组合）

import type { ReactNode } from 'react'

interface AppShellProps {
  chrome: ReactNode
  children: ReactNode
}

export function AppShell({ chrome, children }: AppShellProps) {
  return (
    <div className="shell">
      {chrome}
      <div className="body">
        <div className="app">
          {children}
        </div>
      </div>
    </div>
  )
}
