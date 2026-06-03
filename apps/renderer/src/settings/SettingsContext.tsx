import { createContext, useContext, useState, useCallback } from 'react'
import type { ReactNode } from 'react'

export type SettingsSection = 'exec' | 'system' | 'skills'

interface SettingsCtx {
  open: boolean
  section: SettingsSection
  openSettings: (s?: SettingsSection) => void
  closeSettings: () => void
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
  const openSettings = useCallback((s: SettingsSection = 'exec') => {
    setSection(s)
    setOpen(true)
  }, [])
  const closeSettings = useCallback(() => setOpen(false), [])
  return (
    <Ctx.Provider value={{ open, section, openSettings, closeSettings }}>
      {children}
    </Ctx.Provider>
  )
}
