import { AppNav } from './nav/AppNav'
import { SettingsProvider, useSettings } from './settings/SettingsContext'
import { Settings } from './settings/Settings'
import { VersionBadge } from './shell/VersionBadge'

function SettingsHost() {
  const { open, section, closeSettings } = useSettings()
  return open ? <Settings section={section} onClose={closeSettings} /> : null
}

export function App() {
  return (
    <SettingsProvider>
      <AppNav />
      <SettingsHost />
      <VersionBadge />
    </SettingsProvider>
  )
}
