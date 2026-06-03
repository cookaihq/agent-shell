// Topbar.tsx — .topbar，对照 app.js renderTopbar L85-91
import { RuntimeSwitcher } from '../workspace/RuntimeSwitcher'
import { useSettings } from '../settings/SettingsContext'

export function Topbar() {
  const { openSettings } = useSettings()
  return (
    <div className="topbar" id="topbar">
      <RuntimeSwitcher />
      <div className="inline-switcher">
        <button className="cog" title="设置" onClick={() => openSettings()}>
          <svg viewBox="0 0 24 24" width={17} height={17} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round">
            <circle cx="12" cy="12" r="3" />
            <path d="M19 13a1.6 1.6 0 0 0 .3 1.8 2 2 0 1 1-2.8 2.8 1.6 1.6 0 0 0-2.8 1V21a2 2 0 1 1-4 0 1.6 1.6 0 0 0-2.8-1 2 2 0 1 1-2.8-2.8A1.6 1.6 0 0 0 5 13a2 2 0 1 1 0-4 1.6 1.6 0 0 0 1.4-2.5A2 2 0 1 1 9.2 3.7 1.6 1.6 0 0 0 11 4a2 2 0 1 1 4 0 1.6 1.6 0 0 0 2.8-.3 2 2 0 1 1 2.8 2.8A1.6 1.6 0 0 0 21 9a2 2 0 1 1 0 4z" />
          </svg>
        </button>
      </div>
    </div>
  )
}
