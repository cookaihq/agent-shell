import { createContext, useContext, useState, useCallback, useEffect } from 'react'
import type { ReactNode } from 'react'
import { api } from '../api/client'

export type SettingsSection = 'exec' | 'system' | 'secrets' | 'reminders' | 'proxy'

interface SettingsCtx {
  open: boolean
  section: SettingsSection
  openSettings: (s?: SettingsSection) => void
  closeSettings: () => void
  debugMode: boolean
  setDebugMode: (v: boolean) => void
}

const Ctx = createContext<SettingsCtx | null>(null)

export function useSettings(): SettingsCtx {
  const c = useContext(Ctx)
  if (!c) throw new Error('useSettings must be used inside SettingsProvider')
  return c
}

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false)
  const [section, setSection] = useState<SettingsSection>('exec')
  const [debugMode, setDebug] = useState(false)
  const openSettings = useCallback((s: SettingsSection = 'exec') => {
    setSection(s)
    setOpen(true)
  }, [])
  const closeSettings = useCallback(() => setOpen(false), [])
  useEffect(() => { api.getConfig().then((c) => setDebug(!!c.debugMode)).catch(() => {}) }, [])
  const setDebugMode = useCallback((v: boolean) => {
    setDebug(v)
    api.saveConfig({ debugMode: v }).catch(() => {})
  }, [])
  return (
    <Ctx.Provider value={{ open, section, openSettings, closeSettings, debugMode, setDebugMode }}>
      {children}
    </Ctx.Provider>
  )
}
