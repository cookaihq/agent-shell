// EntryShell.tsx — home/projects 外壳，对照 home.html L11-18
import type { ReactNode } from 'react'

interface EntryShellProps { chrome: ReactNode; rail: ReactNode; topbar: ReactNode; children: ReactNode }

export function EntryShell({ chrome, rail, topbar, children }: EntryShellProps) {
  return (
    <div className="shell">
      {chrome}
      <div className="body">
        <div className="entry">
          {rail}
          <div className="main">
            {topbar}
            <div className="main-inner">{children}</div>
          </div>
        </div>
      </div>
    </div>
  )
}
